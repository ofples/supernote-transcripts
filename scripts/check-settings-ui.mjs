import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const moduleRoot = "C:/Users/pless/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(import.meta.url);
const { chromium } = require(join(moduleRoot, "playwright"));
const evidenceDir = resolve("test-artifacts/settings-ui-screenshots");
await mkdir(evidenceDir, { recursive: true });

let assertions = 0;
const assert = (condition, message) => {
  assertions++;
  if (!condition) throw new Error(message);
};
const reports = [];

async function launch(platform, viewport) {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [], externalRequests = [];
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(/^https?:\/\//, async (route) => { externalRequests.push(route.request().url()); await route.abort(); });
  await page.goto(pathToFileURL(resolve(`private/ux-streamline/build/${platform}/index.html`)).href);
  const root = page.locator(".st-fullscreen-modal");
  await root.waitFor();
  if (platform === "nomad") await root.evaluate((element) => { element.style.inset = "0px"; });
  return { browser, page, root, errors, externalRequests };
}

async function inspectSettings(page, root, platform, viewport, screenshotName) {
  const openSettings = root.locator('button[aria-label="Settings"]');
  await openSettings.focus();
  await page.keyboard.press("Enter");
  assert(await root.locator("h1").innerText() === "Settings", `${platform}: keyboard activation did not open Settings`);
  await page.keyboard.press("Tab");
  const focusState = await page.evaluate(() => {
    const active = document.activeElement;
    return { insideModal: !!active?.closest(".st-fullscreen-modal"), focusVisible: active?.matches(":focus-visible") ?? false, tag: active?.tagName, label: active?.getAttribute("aria-label") };
  });
  assert(focusState.insideModal && focusState.focusVisible, `${platform}: keyboard focus did not remain visible inside Settings: ${JSON.stringify(focusState)}`);
  const expectedHeadings = ["Connection", "Updates", "Recognition", "Transcript", "Advanced"];
  const headings = await root.locator(".st-settings-section > .st-section-heading, .st-settings-advanced > summary").allTextContents();
  assert(JSON.stringify(headings) === JSON.stringify(expectedHeadings), `${platform}: settings sections not in the expected order: ${JSON.stringify(headings)}`);
  for (const label of ["Provider", "AI recognition", "Automatic catch-up", "Simultaneous requests", "Check interval (minutes)", "Default model", "Recognition quality", "Show page headings in transcripts"]) {
    assert(await root.getByText(label, { exact: true }).count() === 1, `${platform}: routine setting is missing or duplicated: ${label}`);
    const locator = root.getByText(label, { exact: true }).first();
    assert(await locator.evaluate((node) => !node.closest("details")), `${platform}: routine setting is hidden inside a disclosure: ${label}`);
  }
  const advanced = root.locator(".st-settings-advanced");
  assert(await advanced.count() === 1 && await advanced.locator("summary").innerText() === "Advanced", `${platform}: expected exactly one Advanced disclosure`);
  assert(!(await advanced.evaluate((element) => element.open)), `${platform}: Advanced should start collapsed`);
  assert(await advanced.locator("details").count() === 0, `${platform}: Advanced contains a nested disclosure`);
  assert(await advanced.getByText("Responses API endpoint", { exact: true }).count() === 1, `${platform}: Advanced endpoint setting is missing`);
  assert(await advanced.getByText("Responses API endpoint", { exact: true }).evaluate((node) => !!node.closest("details")), `${platform}: endpoint setting escaped Advanced`);

  const fieldLabels = await root.locator(".st-form .st-field > span, .st-form .st-check-row > span").evaluateAll((labels) => labels.map((label) => {
    const style = getComputedStyle(label);
    return { text: label.textContent?.trim(), family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  }).filter((label) => label.text));
  assert(fieldLabels.length >= 8, `${platform}: settings field-label typography check found too few labels (${fieldLabels.length})`);
  const fieldTypography = [...new Set(fieldLabels.map((label) => `${label.family}|${label.size}|${label.weight}`))];
  assert(fieldTypography.length <= 1, `${platform}: settings field labels use inconsistent typography: ${JSON.stringify(fieldLabels)}`);

  const cancel = root.getByRole("button", { name: "Cancel", exact: true });
  const cancelBorder = await cancel.evaluate((button) => {
    const style = getComputedStyle(button), rect = button.getBoundingClientRect();
    return { borderStyle: style.borderStyle, borderWidth: style.borderTopWidth, borderColor: style.borderTopColor, width: rect.width, height: rect.height };
  });
  assert(parseFloat(cancelBorder.borderWidth) > 0 && cancelBorder.borderStyle !== "none", `${platform}: visible secondary Cancel action has no border: ${JSON.stringify(cancelBorder)}`);
  assert(cancelBorder.width >= (platform === "nomad" ? 48 : 36) && cancelBorder.height >= (platform === "nomad" ? 48 : 36), `${platform}: Cancel action target is too small: ${JSON.stringify(cancelBorder)}`);

  const settingsGear = root.locator('button[aria-label="Close settings"]');
  assert(await settingsGear.count() === 1, `${platform}: Settings gear/close button disappeared on Settings`);
  const gearBounds = await settingsGear.boundingBox();
  assert(gearBounds && gearBounds.width >= (platform === "nomad" ? 48 : 36) && gearBounds.height >= (platform === "nomad" ? 48 : 36), `${platform}: Settings gear target is too small: ${JSON.stringify(gearBounds)}`);
  await page.screenshot({ path: join(evidenceDir, screenshotName), fullPage: false });

  const layout = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    modalOverflowX: [...document.querySelectorAll(".st-fullscreen-modal, .st-body")].some((element) => element.scrollWidth > element.clientWidth + 1),
    modal: (() => { const element = document.querySelector(".st-fullscreen-modal"), r = element?.getBoundingClientRect(); return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom, className: element.className, cssWidth: getComputedStyle(element).width }; })(),
  }));
  assert(!layout.documentOverflowX && !layout.modalOverflowX, `${platform}: settings overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
  assert(layout.modal && layout.modal.left >= -1 && layout.modal.right <= viewport.width + 1, `${platform}: settings modal extends outside the viewport at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout.modal)}`);
  return { headings, fieldTypography, fieldLabelCount: fieldLabels.length, cancelBorder, gearBounds, layout };
}

for (const platform of ["desktop", "nomad"]) {
  const widths = platform === "desktop" ? [{ width: 1280, height: 900 }, { width: 749, height: 999 }, { width: 375, height: 999 }] : [{ width: 749, height: 999 }, { width: 375, height: 999 }];
  let platformReport;
  for (const viewport of widths) {
    const { browser, page, root, errors, externalRequests } = await launch(platform, viewport);
    const report = await inspectSettings(page, root, platform, viewport, `${platform}-${viewport.width}x${viewport.height}-settings.png`);
    if (viewport.width === 1280 || (platform === "nomad" && viewport.width === 749)) platformReport = report;

    if (platform === "desktop" && viewport.width === 1280) {
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { (window.__copiedAddresses ??= []).push(value); } } }));
      await root.getByLabel("Provider").selectOption("subscription");
      await page.evaluate(() => window.__streamlinedFixture.controller.setSubscriptionStatus({ connected: true, status: "Synthetic fixture account", email: "fixture@example.test" }));
      await root.getByRole("button", { name: "Connect a Nomad", exact: true }).click();
      const card = root.locator(".st-pairing-card");
      await card.waitFor();
      const expectedAddresses = ["192.168.1.40:19457", "10.0.0.8:19457"];
      for (const address of expectedAddresses) {
        const copy = root.getByRole("button", { name: `Copy desktop address ${address}`, exact: true });
        assert(await copy.isVisible(), `desktop: missing Copy action beside pairing address ${address}`);
        const copyBounds = await copy.boundingBox();
        assert(copyBounds && copyBounds.width >= 36 && copyBounds.height >= 36, `desktop: address Copy target is smaller than 36px: ${JSON.stringify(copyBounds)}`);
        await copy.click();
      }
      const copied = await page.evaluate(() => window.__copiedAddresses ?? []);
      assert(JSON.stringify(copied) === JSON.stringify(expectedAddresses), `desktop: address Copy did not preserve the exact URL and port: ${JSON.stringify(copied)}`);
      const counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
      assert(counters.startSubscriptionPairing === 1 && counters.stopSubscriptionPairing === 0, `desktop: Copy unexpectedly changed pairing lifecycle: ${JSON.stringify(counters)}`);
      assert(counters.connectSubscription === 0 && counters.finishSubscriptionLogin === 0 && counters.pairSubscriptionDesktop.length === 0, `desktop: Copy initiated sign-in or pairing: ${JSON.stringify(counters)}`);
      assert(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.update) === 0, "desktop: pairing Copy initiated recognition");
      assert(await card.getByRole("button", { name: "Copy pairing code", exact: true }).count() === 1, "desktop: normal pairing-code Copy control disappeared");
    }
    if ((platform === "desktop" && viewport.width === 1280) || (platform === "nomad" && viewport.width === 749)) {
      await root.getByRole("button", { name: "Cancel", exact: true }).click();
      await root.locator('button[aria-label="Configure Research"]').click();
      const sourceForm = root.locator(".st-form").last();
      const visibleHeadings = await sourceForm.locator(".st-section-heading, h2, .st-source-advanced > summary").allTextContents();
      assert(visibleHeadings.some((text) => /what to mirror/i.test(text)), `${platform}: source scope section is missing: ${JSON.stringify(visibleHeadings)}`);
      assert(visibleHeadings.some((text) => /recognition/i.test(text)), `${platform}: source recognition settings are missing: ${JSON.stringify(visibleHeadings)}`);
      const sourceAdvanced = sourceForm.locator(".st-source-advanced");
      assert(visibleHeadings.some((text) => /^advanced$/i.test(text.trim())), `${platform}: source Advanced section is missing: ${JSON.stringify(visibleHeadings)}`);
      assert(await sourceAdvanced.count() === 1 && !(await sourceAdvanced.evaluate((element) => element.open)), `${platform}: source Advanced disclosure missing or open by default`);
      assert(await sourceAdvanced.locator("details").count() === 0, `${platform}: source Advanced contains a nested disclosure`);
      for (const label of ["Automatically recognize new and changed pages", "Use source-specific recognition settings", "Instructions and reference files", "Output folder"]) {
        assert(await sourceForm.getByText(label, { exact: true }).count() === 1, `${platform}: source editor routine setting missing: ${label}`);
        assert(await sourceForm.getByText(label, { exact: true }).evaluate((node) => !node.closest("details")), `${platform}: source editor routine setting is hidden in a disclosure: ${label}`);
      }
      await page.screenshot({ path: join(evidenceDir, `${platform}-${viewport.width}x${viewport.height}-source-settings.png`), fullPage: false });
      await root.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    assert(errors.length === 0, `${platform}: browser errors: ${errors.join("; ")}`);
    assert(externalRequests.length === 0, `${platform}: fixture attempted external requests: ${externalRequests.join(", ")}`);
    await browser.close();
  }
  reports.push({ platform, settings: platformReport, viewports: widths.map(({ width, height }) => `${width}x${height}`), noExternalRequests: true, browserErrors: 0, ...(platform === "desktop" ? { pairingAddressCopyExact: true, pairingCopyDoesNotStartSignInOrRecognition: true } : {}) });
}

const evidence = { verificationMode: "headless local browser mock", syntheticDataOnly: true, externalRequests: 0, providerAuthentication: false, recognitionCalls: 0, assertions, reports, screenshots: evidenceDir };
const evidencePath = resolve("test-artifacts/settings-ui-evidence.json");
await writeFile(evidencePath, `${JSON.stringify({ ...evidence, evidencePath }, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
