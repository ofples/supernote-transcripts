import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const moduleRoot = "C:/Users/pless/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(import.meta.url);
const { chromium } = require(join(moduleRoot, "playwright"));
const evidenceDir = resolve("private/ux-streamline/evidence/subscription-pairing");
const evidencePath = resolve("test-artifacts/subscription-pairing-ui-evidence.json");
await mkdir(evidenceDir, { recursive: true });
await mkdir(resolve("test-artifacts"), { recursive: true });

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const secretFixtureCode = "23456789ABCDEFGHJKLM";
const groupedFixtureCode = "2345-6789-ABCD-EFGH-JKLM";
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
  await root.locator('button[aria-label="Settings"]').click();
  await page.getByLabel("Provider").selectOption("subscription");
  return { browser, page, root, errors, externalRequests };
}

async function snapshots(page) {
  return page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    return JSON.stringify({ config: c.config, account: c.subscriptionAccount });
  });
}

async function layout(page, root, label, minimumTarget = 48) {
  return page.evaluate(({ name, minimumTarget }) => {
    const modal = document.querySelector(".st-fullscreen-modal");
    const footer = modal?.querySelector(".st-footer");
    const buttons = [...(modal?.querySelectorAll(".st-pairing-start, .st-pairing-copy, .st-pairing-cancel, .st-pairing-connect, .st-pairing-address-copy") ?? [])];
    const bounds = (element) => {
      const r = element.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      label: name,
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      modal: modal ? bounds(modal) : null,
      footer: footer ? bounds(footer) : null,
      pairingTargets: buttons.map((button) => bounds(button)),
      minimumTargetPx: minimumTarget,
      targetsAtLeastMinimum: buttons.every((button) => {
        const r = button.getBoundingClientRect();
        return r.width >= minimumTarget && r.height >= minimumTarget;
      }),
    };
  }, { name: label, minimumTarget });
}

{
  const { browser, page, root, errors, externalRequests } = await launch("desktop", { width: 1100, height: 900 });
  const before = await snapshots(page);
  const setStatus = (status) => page.evaluate((value) => window.__streamlinedFixture.controller.setSubscriptionStatus(value), status);
  await setStatus({ connected: true, status: "Synthetic fixture account", email: "fixture@example.test" });

  assert((await root.locator(".st-subscription-status").innerText()) === "Connected as fixture@example.test", `desktop connected status missing: ${await root.locator(".st-subscription-status").innerText()} / ${JSON.stringify(await page.evaluate(() => window.__streamlinedFixture.controller.subscriptionStatus))}`);
  const connectNomad = root.getByRole("button", { name: "Connect a Nomad", exact: true });
  assert(await connectNomad.count() === 1, "desktop connected account does not offer Connect a Nomad");

  await setStatus({ connected: false, needsSignIn: false, status: "Not connected" });
  assert(await root.getByRole("button", { name: "Connect ChatGPT account", exact: true }).count() === 1, "desktop normal ChatGPT connect flow is missing");
  assert(await root.getByRole("button", { name: "Connect a Nomad", exact: true }).count() === 1, "desktop pairing action disappeared while disconnected");
  await setStatus({ connected: true, status: "Synthetic fixture account", email: "fixture@example.test" });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__syntheticClipboard = value; } },
    });
  });
  await root.getByRole("button", { name: "Connect a Nomad", exact: true }).click();
  const card = root.locator(".st-pairing-card");
  await card.waitFor();
  assert((await card.innerText()).includes("192.168.1.40:19457"), "first desktop pairing address missing");
  assert((await card.innerText()).includes("10.0.0.8:19457"), "second desktop pairing address missing");
  assert((await card.innerText()).includes("Keep desktop Obsidian open and connect from Nomad on the same Wi-Fi."), "same-Wi-Fi guidance missing");
  assert((await card.locator(".st-pairing-code").innerText()) === groupedFixtureCode, "short pairing code was not grouped into five four-character chunks");
  assert((await card.locator(".st-pairing-status").innerText()).includes("Waiting for the Nomad"), "pairing host status is not readable");
  assert((await card.innerText()).includes("Code expires in about 10 minutes."), "pairing expiry is missing");
  await card.getByRole("button", { name: "Copy pairing code", exact: true }).click();
  assert(await page.evaluate(() => window.__syntheticClipboard) === secretFixtureCode, "Copy code did not copy the complete ungrouped value");
  assert(await root.locator(".st-settings-connection > button").filter({ hasText: "Disconnect ChatGPT account" }).count() === 1, "pairing card hid the existing connected account controls");
  const desktopLayout = await layout(page, root, "desktop-pairing-1100x900", 36);
  assert(!desktopLayout.documentOverflowX && desktopLayout.targetsAtLeastMinimum, `desktop pairing controls overflow or miss the 36px target size: ${JSON.stringify(desktopLayout)}`);
  await page.screenshot({ path: join(evidenceDir, "desktop-pairing-1100x900.png"), fullPage: false });
  await card.getByRole("button", { name: "Cancel pairing", exact: true }).click();
  assert(await root.locator(".st-pairing-card").count() === 0, "Cancel pairing left the card open");
  const desktopCounts = await page.evaluate(() => ({
    start: window.__streamlinedFixture.controller.actionCounters.startSubscriptionPairing,
    stop: window.__streamlinedFixture.controller.actionCounters.stopSubscriptionPairing,
  }));
  assert(desktopCounts.start === 1 && desktopCounts.stop === 1, "desktop pairing start/cancel fake actions were not called exactly once");
  assert((await snapshots(page)) === before, "desktop pairing UI action changed the fake account/config state");
  assert(errors.length === 0, `desktop fixture browser errors: ${errors.join("; ")}`);
  assert(externalRequests.length === 0, "desktop fixture attempted an external request");
  reports.push({
    platform: "desktop", viewport: desktopLayout.viewport,
    normalConnectFlowPreserved: true, pairingAvailableWhileConnected: true,
    addressesAndStatusDisplayed: true, shortCodeDisplayedInFiveGroups: true,
    copyUsesFullUnformattedCode: true, cancelCallsFakeOnce: true,
    connectedAccountAndConfigPreserved: true, noHorizontalOverflow: !desktopLayout.documentOverflowX,
    pairingTargetsAtLeast36px: desktopLayout.targetsAtLeastMinimum,
    externalRequests: externalRequests.length, browserErrors: errors.length,
  });
  await browser.close();
}

{
  const { browser, page, root, errors, externalRequests } = await launch("nomad", { width: 768, height: 1024 });
  const before = await snapshots(page);
  await page.evaluate(() => window.__streamlinedFixture.controller.setSubscriptionStatus({ connected: false, needsSignIn: true, pairingPending: true, status: "Sign in required." }));
  assert(await root.getByRole("heading", { name: "Sign in from desktop", exact: true }).count() === 1, "Nomad desktop-pairing sign-in section missing");
  const address = root.locator(".st-nomad-pairing input[type=url]");
  const codeLabelCount = await root.getByLabel("Pairing code").count();
  assert(await address.count() === 1 && codeLabelCount === 1, `Nomad address/code inputs missing (${await address.count()}/${codeLabelCount}): ${await root.locator(".st-nomad-pairing").innerText()}`);
  assert(await address.evaluate(input => input.labels?.length === 1 && !input.labels[0].querySelector("button")), "Desktop address label must remain associated with the input and contain no interactive buttons");
  assert(await root.getByRole("button", { name: "Finish sign-in", exact: true }).count() === 1, "Nomad Finish sign-in action missing");
  assert(await root.getByRole("button", { name: "Cancel sign-in", exact: true }).count() === 1, "Nomad pending sign-in does not offer Cancel sign-in beside Finish sign-in");
  assert(await root.getByRole("button", { name: /Reconnect ChatGPT account/ }).count() === 0, "Nomad legacy browser connection is not hidden by default");

  const code = root.getByLabel("Pairing code");
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.discoveryResults = [{ address: "http://192.168.1.40:19457" }];
  });
  await root.getByRole("button", { name: "Discover", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-live="polite"]')?.textContent?.includes("Desktop found"));
  assert(await address.inputValue() === "http://192.168.1.40:19457", "single discovered desktop did not fill the address input");
  assert(await code.inputValue() === "", "discovery unexpectedly filled or changed the pairing code");
  assert((await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.pairSubscriptionDesktop)).length === 0, "discovery initiated pairing or authentication");

  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.discoveryResults = [{ address: "http://192.168.1.40:19457" }, { address: "http://10.0.0.8:19457" }];
  });
  await root.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByText("Choose a desktop address:").waitFor();
  await root.getByRole("button", { name: "http://10.0.0.8:19457", exact: true }).click();
  assert(await address.inputValue() === "http://10.0.0.8:19457", "multiple discovered desktops could not be selected");
  assert(await root.getByText("Address selected. Enter its pairing code below.").count() === 1, "desktop selection did not give the next step");

  await page.evaluate(() => { window.__streamlinedFixture.controller.discoveryResults = []; });
  await root.getByRole("button", { name: "Discover", exact: true }).click();
  await root.getByText(/No active desktop found/).waitFor();
  assert(await root.getByText(/enter its address manually/i).count() === 1, "empty discovery did not explain manual address entry");

  await page.evaluate(() => { window.__streamlinedFixture.controller.discoveryError = "Shared vault unavailable."; });
  await root.getByRole("button", { name: "Discover", exact: true }).click();
  await root.getByText("Shared vault unavailable.").waitFor();
  await page.evaluate(() => { window.__streamlinedFixture.controller.discoveryError = undefined; });

  await address.fill("192.168.1.40:19457");
  await code.fill(groupedFixtureCode);
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.discoveryDeferred = true;
  });
  await root.getByRole("button", { name: "Discover", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".st-pairing-discover")?.textContent === "Finding…");
  await root.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  await page.evaluate(() => {
    const c = window.__streamlinedFixture.controller;
    c.resolveDiscovery([{ address: "http://10.0.0.99:19457" }]);
    c.discoveryDeferred = false;
  });
  await page.waitForTimeout(50);
  assert(await address.inputValue() === "192.168.1.40:19457", "late discovery response after cancellation changed the address draft");
  assert(await root.getByText("Desktop found. Enter its pairing code below.").count() === 0, "late discovery response after cancellation changed the UI");
  assert(await code.inputValue() === groupedFixtureCode, "late discovery response after cancellation changed the code draft");

  await root.locator(".st-run-behavior input[type=checkbox]").first().check();

  await page.evaluate(() => window.__streamlinedFixture.controller.setSubscriptionStatus({ connected: false, needsSignIn: true, pairingPending: true, status: "Waiting for desktop pairing." }));
  assert(await address.inputValue() === "192.168.1.40:19457", "desktop address draft was lost after a controller rerender");
  assert(await code.inputValue() === groupedFixtureCode, "pairing-code draft was lost after a controller rerender");
  assert(await root.locator(".st-run-behavior input[type=checkbox]").first().isChecked(), "other settings draft was lost after a controller rerender");

  const beforePair = await snapshots(page);
  await root.getByRole("button", { name: "Connect", exact: true }).click();
  const pairCalls = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.pairSubscriptionDesktop);
  assert(pairCalls.length === 1 && pairCalls[0].address === "192.168.1.40:19457" && pairCalls[0].code === secretFixtureCode, "Nomad Connect did not call the fake pairing action once with normalized values");
  assert(await address.inputValue() === "192.168.1.40:19457" && await code.inputValue() === groupedFixtureCode, "Nomad pairing drafts did not survive the action rerender");
  assert((await snapshots(page)) === beforePair, "Nomad pairing action changed fake account/config state");

  const beforeCancel = await snapshots(page);
  await root.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  const cancelCount = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.cancelSubscriptionPairing);
  assert(cancelCount === 2, "Nomad Cancel sign-in did not call both fake cancellation checks exactly once");
  assert(await address.inputValue() === "192.168.1.40:19457" && await code.inputValue() === groupedFixtureCode, "Cancel sign-in lost address/code drafts");
  assert((await snapshots(page)) === beforeCancel, "Cancel sign-in changed the fake account/config state");

  const advanced = root.locator(".st-settings-advanced");
  assert(await advanced.count() === 1 && await advanced.locator("summary").innerText() === "Advanced", "Nomad Advanced disclosure missing");
  assert(await root.locator(".st-settings-section details details").count() === 0, "Nomad settings contain nested Advanced disclosures");
  assert(await advanced.locator("button").filter({ hasText: "Reconnect ChatGPT account" }).count() === 1, "legacy reconnect control missing inside Advanced");
  assert(await root.getByRole("button", { name: /Reconnect ChatGPT account/ }).count() === 0, "legacy reconnect control is exposed before opening Advanced connection");
  await advanced.locator("summary").click();
  assert(await advanced.getByRole("button", { name: "Reconnect ChatGPT account", exact: true }).isVisible(), "legacy reconnect does not open from Advanced");
  await advanced.locator("summary").click();
  await root.locator(".st-body").evaluate((body) => { body.scrollTop = 32; });
  await page.screenshot({ path: join(evidenceDir, "nomad-pairing-768x1024.png"), fullPage: false });

  const nomadLayout = await layout(page, root, "nomad-pairing-768x1024");
  assert(!nomadLayout.documentOverflowX && nomadLayout.targetsAtLeastMinimum, "Nomad pairing controls overflow or miss the 48px target size");
  await address.focus();
  // The builder's generic desktop-style frame has a 16px inset; Nomad uses a full-screen modal.
  await root.evaluate((element) => { element.style.inset = "0px"; });
  await page.evaluate(() => document.documentElement.style.setProperty("--keyboard-height", "360px"));
  await page.waitForTimeout(100);
  const keyboardLayout = await layout(page, root, "nomad-keyboard-768x1024");
  assert(keyboardLayout.modal.height <= 664, "Nomad modal did not resize to leave room for the simulated keyboard");
  assert(keyboardLayout.footer.bottom <= keyboardLayout.modal.bottom && keyboardLayout.footer.bottom <= 664, `Nomad settings footer is hidden behind the simulated keyboard: ${JSON.stringify(keyboardLayout)}`);
  assert(!keyboardLayout.documentOverflowX, "Nomad keyboard layout caused horizontal overflow");

  const counts = await page.evaluate(() => ({
    finish: window.__streamlinedFixture.controller.actionCounters.finishSubscriptionLogin,
    reconnect: window.__streamlinedFixture.controller.actionCounters.connectSubscription,
  }));
  await root.getByRole("button", { name: "Finish sign-in", exact: true }).click();
  const finishCount = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.finishSubscriptionLogin);
  assert(finishCount === counts.finish + 1, "Nomad Finish sign-in fake action was not reachable");
  assert(errors.length === 0, `Nomad fixture browser errors: ${errors.join("; ")}`);
  assert(externalRequests.length === 0, "Nomad fixture attempted an external request");
  reports.push({
    platform: "nomad", viewport: nomadLayout.viewport,
    desktopPairingDefault: true, draftFieldsAndSettingsPreserved: true,
    pairingCalledOnceWithNormalizedValues: true, finishSignInReachable: finishCount === counts.finish + 1,
    legacyBrowserControlHiddenInTheSingleAdvancedDisclosureByDefault: true,
    noHorizontalOverflow: !nomadLayout.documentOverflowX,
    pairingTargetsAtLeast48px: nomadLayout.targetsAtLeastMinimum,
    simulatedKeyboardModalHeight: keyboardLayout.modal.height,
    keyboardFixtureUsesFullScreenFrame: true,
    footerVisibleAboveSimulatedKeyboard: keyboardLayout.footer.bottom <= 664,
    fakeActions: { pairCalls: 1, cancelPairingCalls: cancelCount, discoverCalls: 5, finishCalls: finishCount, reconnectCalls: counts.reconnect },
    accountAndConfigPreserved: true, externalRequests: externalRequests.length, browserErrors: errors.length,
  });
  await browser.close();
}

const evidence = {
  verificationMode: "headless local browser fixture",
  syntheticOnly: true,
  fixtureProviderRequests: false,
  externalRequests: 0,
  authRequests: false,
  screenshots: evidenceDir,
  reports,
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
