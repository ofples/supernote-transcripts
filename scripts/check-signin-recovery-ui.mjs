import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const moduleRoot = "C:/Users/pless/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(import.meta.url);
const { chromium } = require(join(moduleRoot, "playwright"));
const output = resolve("private/ux-streamline/evidence/signin-recovery");
await mkdir(output, { recursive: true });
await mkdir(resolve("test-artifacts"), { recursive: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const reports = [];

for (const platform of ["desktop", "nomad"]) {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  const errors = [], externalRequests = [];
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(/^https?:\/\//, async (route) => { externalRequests.push(route.request().url()); await route.abort(); });
  await page.goto(pathToFileURL(resolve(`private/ux-streamline/build/${platform}/index.html`)).href);
  const root = page.locator(".st-fullscreen-modal");
  await root.waitFor();
  const fixture = () => page.evaluate(() => (window).__streamlinedFixture);
  const setStatus = async (status) => page.evaluate((value) => {
    const controller = (window).__streamlinedFixture.controller;
    controller.subscriptionStatus = value;
  }, status);
  const openSettings = async () => {
    await root.locator('button[aria-label="Settings"]').click();
    await page.getByLabel("Provider").selectOption("subscription");
  };
  const cancelSettings = async () => root.getByRole("button", { name: "Cancel", exact: true }).click();
  const snapshots = async () => page.evaluate(() => ({
    account: JSON.parse(JSON.stringify((window).__streamlinedFixture.controller.subscriptionAccount)),
    config: JSON.parse(JSON.stringify((window).__streamlinedFixture.controller.config)),
  }));
  const assertPreserved = async (before, label) => {
    const after = await snapshots();
    assert(JSON.stringify(after) === JSON.stringify(before), `${platform}: ${label} changed fixture tokens or config`);
  };

  await setStatus({ connected: true, needsSignIn: true, status: "Session renewal uncertain. Sign in again.", email: "fixture@example.test" });
  await openSettings();
  let statusText = await root.locator(".st-subscription-status").innerText();
  assert(statusText === "Session renewal uncertain. Sign in again.", `${platform}: actual recovery status missing`);
  assert(!statusText.includes("Connected"), `${platform}: recovery state is misleadingly labelled Connected`);
  if (platform === "nomad") {
    assert(await root.getByRole("button", { name: /Reconnect/ }).count() === 0, `${platform}: legacy reconnect action should be under Advanced connection`);
    await root.locator(".st-advanced-connection summary").click();
  }
  const reconnect = root.getByRole("button", { name: /Reconnect/ });
  assert(await reconnect.count() === 1, `${platform}: reconnect action missing`);
  assert(await root.getByRole("button", { name: "Finish sign-in", exact: true }).count() === 1, `${platform}: Finish sign-in is not reachable in recovery state`);
  const accountDetails = root.locator(".st-connection-details:not(.st-advanced-connection)");
  await accountDetails.locator("summary").click();
  const disconnect = accountDetails.getByRole("button", { name: "Disconnect ChatGPT account", exact: true });
  assert(await disconnect.count() === 1, `${platform}: Disconnect is not inside Connection details`);
  assert(await root.locator("button").filter({ hasText: "Disconnect ChatGPT account" }).count() === 1, `${platform}: unexpected Disconnect action count`);
  await accountDetails.locator("summary").click();
  await page.screenshot({ path: join(output, `${platform}-renewal-recovery-settings.png`), fullPage: false });
  let before = await snapshots();
  await reconnect.click();
  assert((await fixture()).controller.actionCounters.connectSubscription === 1, `${platform}: reconnect did not call connectSubscription exactly once`);
  await assertPreserved(before, "reconnect action");
  before = await snapshots();
  await root.getByRole("button", { name: "Finish sign-in", exact: true }).click();
  assert((await fixture()).controller.actionCounters.finishSubscriptionLogin === 1, `${platform}: Finish sign-in did not call its fake action`);
  await assertPreserved(before, "Finish sign-in action");

  await cancelSettings();
  await setStatus({ connected: true, needsSignIn: false, status: "ChatGPT plan connected", email: "fixture@example.test" });
  await openSettings();
  statusText = await root.locator(".st-subscription-status").innerText();
  assert(statusText === "Connected as fixture@example.test", `${platform}: normal connected status is missing or redundant`);
  assert(await root.getByRole("button", { name: /Reconnect/ }).count() === 0, `${platform}: reconnect shown for a healthy connection`);
  assert(await root.getByRole("button", { name: "Connect ChatGPT account", exact: true }).count() === 0, `${platform}: Connect shown for a healthy connection`);
  const healthyDetails = root.locator(".st-connection-details");
  await page.screenshot({ path: join(output, `${platform}-connected-settings.png`), fullPage: false });
  await healthyDetails.locator("summary").click();
  before = await snapshots();
  await healthyDetails.getByRole("button", { name: "Disconnect ChatGPT account", exact: true }).click();
  assert((await fixture()).controller.actionCounters.disconnectSubscription === 1, `${platform}: nested Disconnect did not call its fake action`);
  await assertPreserved(before, "Disconnect action");

  await cancelSettings();
  await setStatus({ connected: false, needsSignIn: false, status: "Not connected" });
  await openSettings();
  statusText = await root.locator(".st-subscription-status").innerText();
  assert(statusText === "Not connected", `${platform}: disconnected status unexpected`);
  const connect = root.getByRole("button", { name: "Connect ChatGPT account", exact: true });
  if (platform === "nomad") {
    assert(await connect.count() === 0, `${platform}: legacy Connect should be inside Advanced connection`);
    await root.locator(".st-advanced-connection summary").click();
  }
  assert(await connect.count() === 1, `${platform}: disconnected Connect action missing`);
  assert(await root.getByRole("button", { name: "Finish sign-in", exact: true }).count() === 1, `${platform}: disconnected Finish sign-in action missing`);
  assert(await root.getByRole("button", { name: "Disconnect ChatGPT account", exact: true }).count() === 0, `${platform}: disconnected state exposes Disconnect`);
  before = await snapshots();
  await connect.click();
  assert((await fixture()).controller.actionCounters.connectSubscription === 2, `${platform}: disconnected Connect did not call its fake action`);
  await assertPreserved(before, "disconnected Connect action");

  const fixtureState = await page.evaluate(() => {
    const c = (window).__streamlinedFixture.controller;
    return { actions: c.actionCounters, aiEnabled: c.aiEnabled, autoEnabled: c.autoEnabled, updates: c.actionCounters.update };
  });
  assert(fixtureState.actions.connectSubscription === 2 && fixtureState.actions.disconnectSubscription === 1 && fixtureState.actions.finishSubscriptionLogin === 1, `${platform}: fake account action counts mismatch`);
  assert(fixtureState.updates === 0 && fixtureState.aiEnabled === false, `${platform}: recognition was enabled or invoked`);
  assert(externalRequests.length === 0, `${platform}: unexpected external request: ${externalRequests.join(", ")}`);
  assert(errors.length === 0, `${platform}: browser errors: ${errors.join("; ")}`);
  await page.screenshot({ path: join(output, `${platform}-disconnected-settings.png`), fullPage: false });
  reports.push({ platform, recoveryReconnectShown: true, connectedLabelSuppressed: true, healthyConnectionNoReconnect: true, disconnectedConnectShown: true,
    finishReachableInRecoveryAndDisconnected: true, disconnectNestedInConnectionDetails: true, fakeActions: fixtureState.actions,
    accountTokensAndConfigPreserved: true, aiCalls: fixtureState.updates, externalRequests: externalRequests.length, browserErrors: errors.length });
  await browser.close();
}

const evidence = { verificationMode: "headless local browser fixture", syntheticOnly: true, network: false, authRequests: false, liveAccount: false, reports, screenshots: output };
const evidencePath = resolve("test-artifacts/signin-recovery-ui-evidence.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
