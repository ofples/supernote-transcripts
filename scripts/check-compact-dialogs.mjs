import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT;
const { chromium } = require(moduleRoot ? join(resolve(moduleRoot), "playwright") : "playwright");
const chrome = process.env.CHROME_EXECUTABLE_PATH;
const output = resolve(root, "test-artifacts/compact-dialogs");
await mkdir(output, { recursive: true });
for (const platform of ["desktop", "nomad"]) {
  execFileSync(process.execPath, ["scripts/build-streamlined-ui-fixture.mjs", `--platform=${platform}`], {
    cwd: root, stdio: ["ignore", "ignore", "inherit"],
  });
}

const viewports = [
  { name: "compact-dark", platform: "desktop", width: 1057, height: 643 },
  { name: "tall-dark", platform: "desktop", width: 1001, height: 957 },
  { name: "short-dark", platform: "desktop", width: 800, height: 500 },
  { name: "narrow-dark", platform: "nomad", width: 390, height: 650 },
  { name: "reflow-dark", platform: "nomad", width: 320, height: 560 },
];
const darkTheme = `body.theme-dark {
  color-scheme: dark;
  --background-primary: #262626;
  --background-secondary: #202020;
  --background-modifier-border: #434343;
  --background-modifier-hover: #353535;
  --background-modifier-form-field: #303030;
  --interactive-normal: #323232;
  --interactive-hover: #3a3a3a;
  --interactive-accent: #8099a8;
  --interactive-accent-hover: #8da6b5;
  --text-normal: #e5e5e5;
  --text-muted: #b1b1b1;
  --text-faint: #969696;
  --text-on-accent: #101010;
  --font-ui-small: 14px;
  --font-ui-medium: 16px;
  background: #171717;
}`;
const tolerance = 2;
const reports = [];
const longFolder = "Yearly planning and research notes with a long source folder name";

async function geometry(dialog) {
  return dialog.evaluate(element => {
    const box = node => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const size = node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop });
    const body = element.querySelector(".st-body");
    const footer = element.querySelector(".st-footer");
    const header = element.querySelector(".st-header");
    const action = footer.querySelector(".st-primary") ?? footer.querySelector("button");
    const actionBox = action && box(action);
    const hit = actionBox && document.elementFromPoint((actionBox.left + actionBox.right) / 2, (actionBox.top + actionBox.bottom) / 2);
    return {
      frame: box(element), header: box(header), body: box(body), footer: box(footer), action: actionBox,
      clickable: !!hit && action.contains(hit),
      scroll: { frame: size(element), body: size(body), shell: size(element.querySelector(".st-shell")), document: size(document.scrollingElement) },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}

function assertInside(box, outer, name) {
  assert(box && box.width > 0 && box.height > 0, `${name} has no visible box`);
  assert(box.left >= outer.left - tolerance && box.right <= outer.right + tolerance &&
    box.top >= outer.top - tolerance && box.bottom <= outer.bottom + tolerance,
  `${name} is clipped: ${JSON.stringify({ box, outer })}`);
}

function assertFrame(geometry, name) {
  assertInside(geometry.frame, { top: 0, left: 0, bottom: geometry.viewport.height, right: geometry.viewport.width }, `${name} dialog`);
  if (geometry.header.height) assertInside(geometry.header, geometry.frame, `${name} header`);
  assertInside(geometry.body, geometry.frame, `${name} content`);
  assertInside(geometry.footer, geometry.frame, `${name} footer`);
  assertInside(geometry.action, geometry.footer, `${name} primary action`);
  assert(geometry.clickable, `${name} primary action is covered`);
  assert(geometry.body.bottom <= geometry.footer.top + tolerance, `${name} footer covers the content`);
  for (const [section, size] of Object.entries(geometry.scroll)) {
    assert(size.scrollWidth <= size.clientWidth + tolerance, `${name} ${section} overflows horizontally: ${JSON.stringify(size)}`);
    if (section !== "body") assert(size.scrollHeight <= size.clientHeight + tolerance, `${name} ${section} scrolls outside the content region: ${JSON.stringify(size)}`);
  }
}

function assertStable(before, after, name) {
  for (const part of ["frame", "header", "footer"]) {
    for (const edge of ["top", "right", "bottom", "left"]) {
      assert(Math.abs(after[part][edge] - before[part][edge]) <= tolerance,
        `${name} moves the ${part} ${edge} edge from ${before[part][edge]} to ${after[part][edge]}`);
    }
  }
}

async function atBottom(dialog, lastSelector) {
  const body = dialog.locator(".st-body");
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const last = body.locator(lastSelector).last();
  return last.evaluate(element => {
    const body = element.closest(".st-body");
    const last = element.getBoundingClientRect();
    const frame = body.getBoundingClientRect();
    return { scrollTop: body.scrollTop, lastBottom: last.bottom, bodyBottom: frame.bottom };
  });
}

async function labelMetrics(buttons) {
  return buttons.evaluateAll(elements => elements.map(element => {
    const range = document.createRange();
    const textNodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.textContent.trim() && !node.parentElement.closest('[aria-hidden="true"]')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const lines = new Set();
    const button = element.getBoundingClientRect();
    let textFits = true;
    while (textNodes.nextNode()) {
      range.selectNodeContents(textNodes.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        lines.add(Math.round(rect.top));
        textFits &&= rect.left >= button.left - 1 && rect.right <= button.right + 1;
      }
    }
    return { name: element.getAttribute("aria-label") ?? element.textContent.trim(), lines: lines.size, textFits, width: button.width };
  }));
}

const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: resolve(chrome) } : {}) });
try {
  for (const viewport of viewports) {
    const { name, platform, width, height } = viewport;
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: "dark" });
    page.setDefaultTimeout(5000);
    const report = { ...viewport, checks: {}, failures: [] };
    const check = (label, callback) => {
      try { callback(); } catch (error) { report.failures.push(`${label}: ${error.message}`); }
    };
    const section = async (label, callback) => {
      try { await callback(); } catch (error) { report.failures.push(`${label}: ${error.message}`); }
    };
    page.on("pageerror", error => report.failures.push(`Browser error: ${error.message}`));
    try {
      const fixture = resolve(root, `private/ux-streamline/build/${platform}/index.html`);
      await page.goto(pathToFileURL(fixture).href);
      await page.locator(".st-fullscreen-modal").waitFor();
      await page.evaluate(() => document.body.classList.add("theme-dark"));
      await page.addStyleTag({ content: darkTheme });
      const dialog = page.locator(".st-fullscreen-modal:not(.st-native-settings)");
      const command = id => page.evaluate(commandId => window.__streamlinedFixture.commands.get(commandId).callback(), id);
      const listing = () => dialog.locator('.st-browser-results[aria-busy="false"]').waitFor();

      await section("Queue", async () => {
        const sources = await geometry(dialog);
        const brand = await dialog.locator(".st-plugin-brand > span").last().innerText();
        const [sourcesTab, queueTab] = await dialog.locator(".st-view-tab").evaluateAll(tabs =>
          tabs.map(tab => tab.getBoundingClientRect().width));
        const configureSource = dialog.getByRole("button", { name: "Configure Research", exact: true });
        const configureVisible = await configureSource.isVisible();
        const labelVisible = await configureSource.locator(".st-icon-button-label").isVisible();
        check("Sources layout matches the workflow design", () => {
          assert.equal(brand, "Supernote Transcripts");
          assert(sourcesTab > 0 && Math.abs(sourcesTab - queueTab) <= tolerance, "Sources and Queue should take equal space");
          assert(configureVisible, "Configure must remain reachable");
          assert(!labelVisible, "Configure should use a compact icon");
        });
        await page.screenshot({ path: join(output, `${name}-sources.png`) });
        await page.evaluate(() => {
          const { controller, paths } = window.__streamlinedFixture;
          const original = controller.store.notebooks[paths.working];
          for (const suffix of ["Field notes", "Research archive", "Weekly planning and research transcript from a long notebook name"]) {
            const source = paths.working.replace(/\/Journal\/Reflection\.note$/, `/One-time/${suffix}.note`);
            controller.store.notebooks[source] = {
              ...structuredClone(original), source, output: `Fixture Output/${suffix}.md`, status: "current",
              oneTime: { profileId: "general" }, publishedHash: `fixture-${suffix}`,
            };
          }
        });
        await dialog.getByRole("button", { name: "Queue", exact: true }).click();
        const queue = await geometry(dialog);
        check("Sources → Queue frame", () => assertStable(sources, queue, "Sources → Queue"));
        check("Queue before scroll", () => assertFrame(queue, "Queue"));
        await page.screenshot({ path: join(output, `${name}-queue-top.png`) });
        await dialog.locator(".st-queue-one-time > summary").click();
        const bottom = await atBottom(dialog, ".st-queue-live > :last-child");
        check("Queue bottom content", () => assert(bottom.lastBottom <= bottom.bodyBottom + tolerance, "Queue bottom content cannot scroll into view"));
        const bottomActions = dialog.locator(".st-queue-one-time").getByRole("button", { name: /Open transcript/ });
        const lastAction = bottomActions.last();
        const bottomHit = await lastAction.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        });
        check("Open transcript at the Queue bottom", () => assert(bottomHit, "The last Open transcript action is clipped or covered"));
        const bottomLabels = await labelMetrics(bottomActions);
        check("Transcript action labels", () => {
          for (const label of bottomLabels) assert(label.lines <= 1 && label.textFits, `Wrapped or clipped Open transcript action: ${JSON.stringify(label)}`);
        });
        const focus = await dialog.locator("[data-queue-key]").last().evaluate(element => {
          element.focus({ preventScroll: true });
          return element.dataset.queueKey;
        });
        const before = await geometry(dialog);
        await page.evaluate(() => {
          const { controller } = window.__streamlinedFixture;
          controller.progress.activePage = { ...controller.progress.activePage, number: 4 };
          controller.progress.detail = "Synthetic queue update while the user is reading the bottom of the panel.";
          controller.notify();
        });
        const after = await geometry(dialog);
        check("Queue activity frame", () => assertStable(before, after, "Queue activity refresh"));
        check("Queue after scroll and refresh", () => assertFrame(after, "Queue after scrolling and refreshing"));
        check("Queue scroll retention", () => assert(Math.abs(before.scroll.body.scrollTop - after.scroll.body.scrollTop) <= tolerance, "Queue activity refresh moves the scroll position"));
        const focused = await page.evaluate(() => document.activeElement?.dataset.queueKey);
        check("Queue keyboard focus", () => assert.equal(focused, focus, "Queue activity refresh loses keyboard focus"));
        report.checks.queue = { sources, queue, after, bottom, bottomLabels };
        await page.screenshot({ path: join(output, `${name}-queue.png`) });
      });

      await section("Picker and source editor", async () => {
        await page.evaluate(folder => {
          const { app, paths, controller } = window.__streamlinedFixture;
          const notes = paths.working.replace(/\/Journal\/Reflection\.note$/, "");
          const fs = app.vault.adapter.fs;
          const read = fs.readdir.bind(fs);
          fs.readdir = async (...args) => {
            const entries = await read(...args);
            return args[0] === notes ? [...entries, { name: folder, isDirectory: () => true, isFile: () => false }] : entries;
          };
          controller.config.rules.push({ ...controller.config.rules[0], id: "long-folder", source: `${notes}/${folder}` });
        }, longFolder);
        await command("add-source");
        await listing();
        if (platform === "nomad") {
          for (const folder of ["UX Fixture", "Notes"]) {
            await dialog.getByRole("button", { name: `Open folder ${folder}`, exact: true }).click();
            await listing();
          }
        }
        const populated = await geometry(dialog);
        check("Populated picker", () => assertFrame(populated, "Populated picker"));
        const configured = dialog.locator(".st-browser-configure");
        const labels = await labelMetrics(configured);
        check("Configured rows", () => {
          assert(labels.length >= 3, `Expected at least three configured folders, saw ${labels.length}`);
          for (const label of labels) {
            assert.match(label.name, /^Configure(?: |$)/, "Configure action is missing its accessible label");
            assert(label.lines <= 1 && label.textFits, `Wrapped or clipped Configure action: ${JSON.stringify(label)}`);
          }
        });
        const longEntry = dialog.getByRole("button", { name: `Open folder ${longFolder}`, exact: true });
        await longEntry.waitFor();
        assert.match(await longEntry.innerText(), /Yearly planning and research notes/);
        const pickerBottom = await atBottom(dialog, ".st-browser-results > :last-child");
        check("Picker bottom content", () => assert(pickerBottom.lastBottom <= pickerBottom.bodyBottom + tolerance, "Picker bottom row cannot scroll into view"));
        const pickerScrolled = await geometry(dialog);
        check("Picker primary action after scroll", () => assertFrame(pickerScrolled, "Picker after scrolling"));
        const entries = dialog.locator(".st-browser-entry");
        await entries.first().focus();
        await entries.first().press("ArrowDown");
        const focusedNext = await entries.nth(1).evaluate(element => document.activeElement === element);
        check("Picker keyboard focus", () => assert(focusedNext, "Picker ArrowDown does not reach the next entry"));
        await dialog.getByRole("button", { name: "Open folder Archive", exact: true }).click();
        await listing();
        await dialog.locator(".st-browser-empty").waitFor();
        const empty = await geometry(dialog);
        check("Empty picker", () => assertFrame(empty, "Empty picker"));
        check("Picker navigation frame", () => assertStable(populated, empty, "Populated → empty picker"));
        await dialog.locator(".st-browser-parent").click();
        await listing();
        const returnedFocus = await dialog.getByRole("button", { name: "Open folder Archive", exact: true }).evaluate(element => document.activeElement === element);
        check("Picker back focus", () => assert(returnedFocus, "Returning to the parent folder does not restore focus on the previous folder"));
        await page.screenshot({ path: join(output, `${name}-picker.png`) });
        await configured.first().click();
        await dialog.locator(".st-source-section").waitFor();
        await dialog.locator(".st-footer").getByRole("button", { name: "Save", exact: true }).waitFor();
        const editor = await geometry(dialog);
        check("Source settings Save at rest", () => assertFrame(editor, "Source settings"));
        await page.screenshot({ path: join(output, `${name}-source-settings-top.png`) });
        const bottom = await atBottom(dialog, ".st-form > :last-child");
        check("Source settings bottom content", () => assert(bottom.lastBottom <= bottom.bodyBottom + tolerance, "Source settings bottom content cannot scroll into view"));
        const editorScrolled = await geometry(dialog);
        check("Source settings Save after scroll", () => assertFrame(editorScrolled, "Source settings after scrolling"));
        check("Source settings frame while scrolling", () => assertStable(editor, editorScrolled, "Source settings scrolling"));
        report.checks.picker = { populated, empty, labels, pickerBottom };
        report.checks.sourceEditor = { editor, editorScrolled, bottom };
        await page.screenshot({ path: join(output, `${name}-source-settings.png`) });
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await listing();
        const returned = await geometry(dialog);
        check("Source settings returns to picker", () => assertStable(populated, returned, "Source settings → picker"));
      });

      await section("Native settings", async () => {
        await dialog.getByRole("button", { name: /^(Close|Close mirrors)$/ }).click();
        await page.evaluate(() => {
          const { settingTab } = window.__streamlinedFixture;
          const host = document.createElement("div");
          host.style.cssText = "height:100%; min-height:0; overflow:auto";
          document.body.style.padding = "0";
          document.body.append(host);
          host.append(settingTab.containerEl);
          settingTab.display();
        });
        const settings = page.locator(".st-native-settings");
        await settings.waitFor();
        const initial = await geometry(settings);
        check("Native settings Save at rest", () => assertFrame(initial, "Native settings"));
        await settings.getByRole("tab", { name: "Recognition" }).click();
        const recognition = await geometry(settings);
        check("Recognition settings Save at rest", () => assertFrame(recognition, "Recognition settings"));
        check("Native settings frame across tabs", () => assertStable(initial, recognition, "Connection → Recognition"));
        await page.screenshot({ path: join(output, `${name}-native-settings-top.png`) });
        const bottom = await atBottom(settings, '[role="tabpanel"]:not([hidden]) > :last-child');
        check("Recognition settings bottom content", () => assert(bottom.lastBottom <= bottom.bodyBottom + tolerance, "Recognition settings bottom content cannot scroll into view"));
        const scrolled = await geometry(settings);
        check("Recognition settings Save after scroll", () => assertFrame(scrolled, "Recognition settings after scrolling"));
        check("Native settings frame while scrolling", () => assertStable(recognition, scrolled, "Recognition settings scrolling"));
        report.checks.nativeSettings = { initial, recognition, scrolled, bottom };
        await page.screenshot({ path: join(output, `${name}-native-settings.png`) });
      });
    } finally {
      reports.push(report);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const evidence = join(output, "geometry.json");
await writeFile(evidence, `${JSON.stringify(reports, null, 2)}\n`);
for (const { name, failures } of reports) {
  console.log(`${name}: ${failures.length ? `${failures.length} failures` : "passed"}`);
  failures.forEach(failure => console.log(`  ${failure}`));
}
console.log(`Evidence: ${evidence}`);
if (reports.some(report => report.failures.length)) process.exitCode = 1;
