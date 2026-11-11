import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (localError) {
  const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT;
  if (!moduleRoot) throw new Error("Playwright is not resolvable; install it locally or set PLAYWRIGHT_MODULE_ROOT", { cause: localError });
  ({ chromium } = require(join(resolve(moduleRoot), "playwright")));
}
const chrome = process.env.CHROME_EXECUTABLE_PATH ? resolve(process.env.CHROME_EXECUTABLE_PATH) : undefined;
const output = resolve(root, "private/ux-streamline/evidence/progress-geometry");
await mkdir(output, { recursive: true });
for (const platform of ["desktop", "nomad"]) execFileSync(process.execPath, ["scripts/build-streamlined-ui-fixture.mjs", `--platform=${platform}`], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });

const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
const reports = [];
try {
  for (const viewport of [{ name: "desktop", platform: "desktop", width: 1280, height: 900 }, { name: "narrow", platform: "nomad", width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const fixture = resolve(root, `private/ux-streamline/build/${viewport.platform}/index.html`);
    await page.goto(pathToFileURL(fixture).href);
    const rootModal = page.locator(".st-fullscreen-modal");
    await rootModal.waitFor().catch(async (error) => {
      console.error(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(0, 700), boot: await page.evaluate(() => typeof window.__bootStreamlinedFixture), fixture: await page.evaluate(() => typeof window.__streamlinedFixture) }));
      throw error;
    });
    await rootModal.getByRole("button", { name: "Sources", exact: true }).click();

    const measure = async () => page.evaluate(() => {
      const rows = [...document.querySelectorAll(".st-queue-row, .st-rule-row")]
        .filter((row) => row.querySelector(":scope > .st-progress-row"));
      return rows.map((row) => {
        const wrapper = row.querySelector(":scope > .st-progress-row");
        const track = wrapper?.querySelector(":scope > .st-progress");
        const fill = track?.querySelector(".st-progress-fill");
        const rowRect = row.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const style = getComputedStyle(row);
        const left = rowRect.left + parseFloat(style.paddingLeft);
        const right = rowRect.right - parseFloat(style.paddingRight);
        return {
          rowClass: row.className,
          rowWidth: rowRect.width,
          wrapperWidth: wrapperRect.width,
          trackWidth: trackRect.width,
          expectedWidth: right - left,
          leftError: Math.abs(wrapperRect.left - left),
          rightError: Math.abs(wrapperRect.right - right),
          label: track.getAttribute("aria-label"),
          valueNow: Number(track.getAttribute("aria-valuenow")),
          valueMin: Number(track.getAttribute("aria-valuemin")),
          valueMax: Number(track.getAttribute("aria-valuemax")),
          fillWidth: parseFloat(fill.style.width),
          wrapperGridColumn: getComputedStyle(wrapper).gridColumn,
        };
      });
    });
    const setActionLabel = (selector, label) => page.evaluate(({ selector, label }) => {
      const action = document.querySelector(`${selector} button`);
      if (!action) return null;
      action.textContent = label;
      const rect = action.getBoundingClientRect();
      const parent = action.parentElement.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(action);
      return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, parentLeft: parent.left, parentRight: parent.right, parentWidth: parent.width, textLines: range.getClientRects().length, label };
    }, { selector, label });
    const verifyGroup = async (selector, expectedClass, screenshotName) => {
      const beforeLabel = await setActionLabel(selector, "Review");
      const before = await measure();
      const afterLabel = await setActionLabel(selector, "Review pages and resolve the selected notebook's saved transcript edits before continuing");
      const after = await measure();
      assert(after.some((item) => item.rowClass.includes(expectedClass)), `${viewport.name}: ${expectedClass} progress row missing; found ${JSON.stringify(after)}`);
      assert(afterLabel && beforeLabel && (afterLabel.width > beforeLabel.width || afterLabel.height > beforeLabel.height), `${viewport.name}: action label did not alter button geometry`);
      assert(afterLabel.x >= afterLabel.parentLeft - 1 && afterLabel.right <= afterLabel.parentRight + 1, `${viewport.name}: action label escapes its available row width`);
      if (viewport.name === "narrow") assert(afterLabel.height > beforeLabel.height && afterLabel.textLines > 1, `${viewport.name}: long action label did not wrap: ${JSON.stringify({ beforeLabel, afterLabel })}`);
      assert.equal(after.length, before.length, `${viewport.name}: progress row count changed with action labels`);
      for (const item of after) {
        assert(item.label, `${viewport.name}: missing accessible progress label`);
        assert.equal(item.valueMin, 0, `${viewport.name}: incorrect progress minimum`);
        assert.equal(item.valueMax, 100, `${viewport.name}: incorrect progress maximum`);
        assert(item.valueNow >= 0 && item.valueNow <= 100, `${viewport.name}: progress value is out of range`);
        assert(Math.abs(item.fillWidth - item.valueNow) <= 0.51, `${viewport.name}: progress fill and accessible count disagree`);
        assert(Math.abs(item.trackWidth - item.expectedWidth) <= 1, `${viewport.name}: track width changed with grid actions: ${JSON.stringify(item)}`);
        assert(item.leftError <= 1 && item.rightError <= 1, `${viewport.name}: progress endpoints do not span the content width: ${JSON.stringify(item)}`);
        assert.equal(item.wrapperGridColumn, "1 / -1", `${viewport.name}: progress row does not span grid columns`);
      }
      await page.screenshot({ path: resolve(output, screenshotName), fullPage: false });
      reports.push({ viewport: { name: viewport.name, platform: viewport.platform, width: viewport.width }, actionBefore: beforeLabel, actionAfter: afterLabel, progressRows: after });
    };
    await verifyGroup(".st-source-actions", "st-rule-row", `${viewport.name}-sources.png`);
    await rootModal.getByRole("button", { name: "Queue" }).click();
    await page.locator(".st-queue-row .st-progress-row").first().waitFor();
    await verifyGroup(".st-queue-actions", "st-queue-row", `${viewport.name}-queue.png`);
    assert.equal(errors.length, 0, `${viewport.name}: browser errors: ${errors.join("; ")}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ browser: "headless Chromium", reports }, null, 2));
