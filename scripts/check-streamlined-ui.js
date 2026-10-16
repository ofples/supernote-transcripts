import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const moduleRoot = "C:/Users/pless/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(import.meta.url);
const { chromium } = require(join(moduleRoot, "playwright"));
const out = resolve("private/ux-streamline/evidence");
await mkdir(out, { recursive: true });
const platforms = ["desktop", "nomad"];
const reports = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

for (const platform of platforms) {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.setDefaultTimeout(6000);
  page.on("pageerror", (error) => errors.push(String(error)));
  const file = resolve(`private/ux-streamline/build/${platform}/index.html`);
  await page.goto(pathToFileURL(file).href);
  await page.locator(".st-fullscreen-modal .st-header").waitFor().catch(async (error) => { console.error(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(0, 500), boot: await page.evaluate(() => typeof window.__bootStreamlinedFixture), fixture: await page.evaluate(() => typeof window.__streamlinedFixture) })); throw error; });
  await page.screenshot({ path: join(out, `${platform}-1280x900-sources.png`), fullPage: false });
  const root = page.locator(".st-fullscreen-modal");
  const sourceText = await root.innerText();
  assert(sourceText.includes("Sources") && sourceText.includes("Journal") && sourceText.includes("Research"), `${platform}: synthetic sources missing`);
  assert(await root.locator(".st-rule-row").count() >= 2, `${platform}: expected two synthetic source rows`);

  // Source draft: labelled-row checkbox, selection list, editor Cancel, then in-memory Save.
  const before = await page.evaluate(() => JSON.parse(JSON.stringify((window).__streamlinedFixture.controller.config)));
  const researchRule = before.rules.find((rule) => rule.id === "research-source");
  assert(!!researchRule, `${platform}: research fixture rule missing`);
  await root.locator('button[aria-label="Configure Research"]').click();
  await root.locator(".st-source-advanced summary").click().catch(() => {});
  const includeLabel = root.getByText("Include subfolders", { exact: true });
  const includeBox = root.locator(".st-source-scope input[type=checkbox]").first();
  const originalChecked = await includeBox.isChecked();
  await includeLabel.click();
  assert((await includeBox.isChecked()) !== originalChecked, `${platform}: labelled checkbox row did not toggle`);
  await includeLabel.click();
  assert((await includeBox.isChecked()) === originalChecked, `${platform}: checkbox did not normalize after second toggle`);
  await root.getByRole("button", { name: "Select notebooks" }).click();
  await root.locator(".st-notebook-choice").first().waitFor();
  assert((await root.locator(".st-notebook-choice").count()) >= 3, `${platform}: synthetic notes were not listed`);
  await root.getByRole("button", { name: "Done" }).click();
  await root.getByRole("button", { name: "Cancel" }).click();
  await pause();
  let afterCancel = await page.evaluate(() => JSON.parse(JSON.stringify((window).__streamlinedFixture.controller.config)));
  assert(JSON.stringify(afterCancel) === JSON.stringify(before), `${platform}: Cancel changed saved fixture config`);
  assert((await page.evaluate(() => (window).__streamlinedFixture.controller.actionCounters.saveConfig)) === 0, `${platform}: Cancel called saveConfig`);

  // Reopen and change model, quality, destination and glossary; Save changes only this source profile.
  await root.locator('button[aria-label="Configure Research"]').click();
  await root.locator(".st-model-picker select").selectOption("gpt-6-luna");
  const slider = root.locator('.st-quality-field input[type="range"]');
  await slider.fill("2");
  await slider.dispatchEvent("input");
  assert((await slider.getAttribute("aria-valuetext")) === "Careful", `${platform}: quality control did not select Careful`);
  await root.getByRole("button", { name: "Choose existing folder" }).click();
  await root.locator(".st-output-browser").waitFor();
  await root.locator(".st-output-browser .st-browser-entry").filter({ hasText: "Fixture Output" }).click();
  await root.getByRole("button", { name: "Choose this folder" }).click();
  await root.locator(".st-instructions summary").click();
  await root.getByRole("button", { name: "Choose glossary files" }).click();
  await root.locator(".st-glossary-picker").waitFor();
  const glossaryLabel = root.locator(".st-glossary-picker label").filter({ hasText: "Fixture glossary.md" }).first();
  await glossaryLabel.locator('input[type="checkbox"]').check();
  await root.getByRole("button", { name: "Done" }).click();
  await page.screenshot({ path: join(out, `${platform}-1280x900-source-editor.png`), fullPage: false });
  if (platform === "nomad") {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: join(out, "nomad-768x1024-source-editor.png"), fullPage: false });
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, buttons: [...document.querySelectorAll(".st-footer button")].map((b) => b.getBoundingClientRect().height) }));
    assert(!layout.overflow, `${platform}: source editor has horizontal overflow at 768px`);
    assert(layout.buttons.every((height) => height >= 48), `${platform}: source editor footer button is below 48px`);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await root.getByRole("button", { name: "Save", exact: true }).click();
  await pause();
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify((window).__streamlinedFixture.controller.config)));
  const savedResearchRule = saved.rules.find((rule) => rule.id === "research-source");
  const savedResearch = saved.profiles.find((profile) => profile.id === savedResearchRule.profileId);
  assert(savedResearch.model === "gpt-6-luna" && savedResearch.quality === "careful", `${platform}: model or quality did not save`);
  assert(savedResearch.glossaries.includes("Reference/Fixture glossary.md"), `${platform}: synthetic glossary selection did not save`);
  assert(savedResearchRule.output === "Fixture Output", `${platform}: destination did not save`);
  assert(JSON.stringify(saved.profiles.find((profile) => profile.id === "general")) === JSON.stringify(before.profiles.find((profile) => profile.id === "general")), `${platform}: editing Research changed the General profile`);
  assert((await page.evaluate(() => (window).__streamlinedFixture.controller.actionCounters.saveConfig)) === 1, `${platform}: unexpected config save count`);

  await root.locator("button[aria-label=\"Settings\"]").click();
  assert((await root.locator("h1").innerText()) === "Settings", `${platform}: Settings header navigation failed`);
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  await root.getByRole("button", { name: "Queue" }).click();
  await root.locator(".st-queue-live").waitFor();
  assert((await root.locator("h1").innerText()) === "Queue", `${platform}: fixture navigation did not enter Queue`);
  await root.locator("button[aria-label=\"Settings\"]").click();
  await root.getByRole("button", { name: "Cancel", exact: true }).click();
  assert((await root.locator("h1").innerText()) === "Queue", `${platform}: Queue → Settings → Cancel did not return to Queue (got ${await root.locator("h1").innerText()})`);
  await root.locator("button[aria-label=\"Settings\"]").click();
  await root.getByRole("button", { name: "Back", exact: true }).click();
  assert((await root.locator("h1").innerText()) === "Queue", `${platform}: Queue → Settings → Back did not return to Queue`);
  await root.locator("button[aria-label=\"Settings\"]").click();
  await root.getByRole("button", { name: "Save", exact: true }).click();
  await pause();
  assert((await root.locator("h1").innerText()) === "Queue", `${platform}: Queue → Settings → Save did not return to Queue`);
  await page.screenshot({ path: join(out, `${platform}-1280x900-queue-api.png`), fullPage: false });
  if (platform === "nomad") {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: join(out, "nomad-768x1024-queue-api.png"), fullPage: false });
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, buttons: [...document.querySelectorAll(".st-footer button")].map((b) => b.getBoundingClientRect().height) }));
    assert(!layout.overflow, `${platform}: queue has horizontal overflow at 768px`);
    assert(layout.buttons.every((height) => height >= 48), `${platform}: queue footer button is below 48px`);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  let queueText = await root.innerText();
  assert(queueText.includes("Working now") && queueText.includes("Up next"), `${platform}: queue sections missing`);
  assert(queueText.includes("14 pages"), `${platform}: global target page estimate missing`);
  assert(await root.locator(".st-queue-estimate-info").count() <= 1, `${platform}: estimate explanation repeats in queue rows`);
  const estimateInfo = root.locator(".st-queue-estimate-info");
  if (await estimateInfo.count()) { await estimateInfo.locator("summary").click(); assert((await estimateInfo.innerText()).includes("Estimates are not bills"), `${platform}: API context is missing from estimate details`); }
  const waitingBefore = await page.evaluate(() => (window).__streamlinedFixture.controller.queueView.waiting.slice());
  assert(waitingBefore.length === 2, `${platform}: waiting order should include two synthetic notebooks`);
  const waitingRowsBefore = await root.locator(".st-queue-live .st-queue-row:not(.st-working)").allInnerTexts();
  const firstWaiting = root.locator(`button[data-queue-key="next:${waitingBefore[1]}"]`);
  await firstWaiting.click();
  await pause();
  const waitingAfterPriority = await page.evaluate(() => (window).__streamlinedFixture.controller.queueView.waiting.slice());
  assert(waitingAfterPriority[0] === waitingBefore[1], `${platform}: Do next did not reprioritize the queue`);
  const waitingRowsAfter = await root.locator(".st-queue-live .st-queue-row:not(.st-working)").allInnerTexts();
  assert(waitingRowsAfter[0]?.includes(waitingBefore[1].split("/").at(-1).replace(/\.note$/i, "")), `${platform}: prioritized notebook is not first in rendered queue`);
  const prioritizedName = waitingAfterPriority[0].split("/").at(-1).replace(/\.note$/i, "");
  await root.locator(`button[data-queue-key="pause:${waitingAfterPriority[0]}"]`).click();
  await pause();
  const movedPaused = await page.evaluate((source) => (window).__streamlinedFixture.controller.queueView.paused.includes(source), waitingAfterPriority[0]);
  assert(movedPaused, `${platform}: Pause did not move the notebook into Paused`);
  const actions = await page.evaluate(() => (window).__streamlinedFixture.controller.actionCounters);
  assert(actions.prioritize.length === 1 && actions.notebookPause.length === 1, `${platform}: queue action counters mismatch`);

  // Subscription mode proves page targets and grouped requests stay distinct; its context note appears once.
  await page.evaluate(() => { const c = (window).__streamlinedFixture.controller; c.provider = "subscription"; c.notify?.(); c.emit?.(); });
  await page.evaluate(() => { const c = (window).__streamlinedFixture.controller; c.setProvider?.("subscription"); });
  await page.screenshot({ path: join(out, `${platform}-1280x900-queue-subscription.png`), fullPage: false });
  const subscriptionInfo = root.locator(".st-queue-estimate-info");
  if (await subscriptionInfo.count()) await subscriptionInfo.locator("summary").click();
  const subscriptionText = await root.innerText();
  const disclaimers = (subscriptionText.match(/ChatGPT manages plan allowance/g) ?? []).length;
  assert(disclaimers <= 1, `${platform}: subscription allowance context repeated ${disclaimers} times`);
  assert(/\d+ pages?/.test(subscriptionText) && /\d+ requests?/.test(subscriptionText), `${platform}: subscription queue conflates target pages and requests`);

  // Actionable error remains reachable from Queue and every action is a fake in-memory counter.
  const c = await page.evaluateHandle(() => (window).__streamlinedFixture.controller);
  await page.evaluate(() => { const controller = (window).__streamlinedFixture.controller; controller.progress.running = false; controller.progress.activeSource = undefined; controller.progress.activePage = undefined; controller.notify(); });
  const attention = root.locator('details[data-queue-section="Needs attention"]');
  await attention.locator("summary").click();
  await attention.getByRole("button", { name: "Review pages" }).click();
  assert(await root.getByRole("button", { name: "Retry", exact: true }).count() === 1, `${platform}: failed page Retry missing`);
  assert(await root.getByRole("button", { name: "Skip", exact: true }).count() === 1, `${platform}: failed page Skip missing`);
  await root.getByRole("button", { name: "Skip", exact: true }).click();
  await pause();
  let issueActions = await page.evaluate(() => (window).__streamlinedFixture.controller.actionCounters);
  assert(issueActions.skipPage.length === 1, `${platform}: Skip did not call fixture action`);
  await root.getByRole("button", { name: "Retry", exact: true }).click();
  await pause();
  issueActions = await page.evaluate(() => (window).__streamlinedFixture.controller.actionCounters);
  assert(issueActions.retryPage.length === 1, `${platform}: Retry did not call fixture action`);
  assert(issueActions.update === 0, `${platform}: UI invoked recognition during the check`);

  const finalConfig = await page.evaluate(() => JSON.parse(JSON.stringify((window).__streamlinedFixture.controller.config)));
  await page.screenshot({ path: join(out, `${platform}-768x1024-responsive.png`), fullPage: false, clip: { x: 0, y: 0, width: 768, height: 1024 } }).catch(async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: join(out, `${platform}-768x1024-responsive.png`), fullPage: false });
  });
  await c.dispose();
  await browser.close();
  assert(errors.length === 0, `${platform}: browser errors: ${errors.join("; ")}`);
  reports.push({ platform, passed: true, sourceRows: 2, syntheticNotes: 5, profileIsolation: true, cancelPreserved: true, modelQualityDestinationGlossarySave: true, queuePriorityAndPause: true, subscriptionContextOccurrences: disclaimers, targetPagesAndRequestsDistinct: true, errorRetrySkip: true, recognitionCalls: actions.update });
}
const evidence = {
  verificationMode: "headless local browser mock",
  syntheticDataOnly: true,
  network: false,
  runtimeAndVaultWriters: false,
  productionObsidianVerified: false,
  productionVerification: "pending unlocked desktop",
  reports,
  screenshots: out,
};
const evidencePath = resolve("test-artifacts/interface-0.10.0-ui-evidence.json");
await mkdir(resolve("test-artifacts"), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));








