import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const reports = [];
const screenshots = resolve(rootPath, "test-artifacts/streamlined-ui-screenshots");
await mkdir(screenshots, { recursive: true });

for (const platform of ["desktop", "nomad"]) {
  execFileSync(process.execPath, ["scripts/build-streamlined-ui-fixture.mjs", `--platform=${platform}`], { cwd: rootPath, stdio: ["ignore", "ignore", "inherit"] });
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: platform === "nomad" ? 390 : 1120, height: 844 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const file = resolve(rootPath, `private/ux-streamline/build/${platform}/index.html`);
  await page.goto(pathToFileURL(file).href);
  await page.locator(".st-fullscreen-modal .st-header").waitFor();
  const root = page.locator(".st-fullscreen-modal");
  const fixture = () => page.evaluate(() => window.__streamlinedFixture);
  const waitList = async () => page.waitForFunction(() => {
    const list = document.querySelector(".st-browser-results");
    return list && list.getAttribute("aria-busy") === "false";
  });
  const openPickerAtNotes = async command => {
    await page.evaluate(name => window.__streamlinedFixture.commands.get(name)?.callback(), command);
    await waitList();
    if (platform === "nomad") {
      await root.getByRole("button", { name: "Open folder UX Fixture" }).click();
      await waitList();
      await root.getByRole("button", { name: "Open folder Notes" }).click();
      await waitList();
    }
  };
  const initialCommands = await page.evaluate(() => [...window.__streamlinedFixture.commands.keys()]);
  assert(initialCommands.includes("add-source"), `${platform}: Add source command missing`);
  assert(initialCommands.includes("transcribe-selection"), `${platform}: Transcribe command missing`);
  if (platform === "nomad") assert(!(await fixture()).workspaceEventNames.includes("file-menu"), "Nomad must not register a vault-relative file-menu transcription action");

  await openPickerAtNotes("add-source");
  await page.screenshot({ path: join(screenshots, `${platform}-add-source-picker.png`) });
  const entryButtons = root.locator(".st-browser-entry");
  const names = await entryButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  assert(names[0] === "Open folder Archive" && names[1] === "Open folder Extra", `${platform}: folders are not sorted before files: ${JSON.stringify(names)}`);
  assert(names.findIndex(name => name?.startsWith("Select notebook ")) > 0, `${platform}: notebook rows are absent from the same list: ${JSON.stringify(names)}`);
  await entryButtons.first().focus();
  await entryButtons.first().press("ArrowDown");
  const keyboardMoved = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  assert(keyboardMoved === names[1], `${platform}: ArrowDown did not move keyboard focus to the next row`);
  await root.getByRole("button", { name: "Open folder Archive" }).click();
  await waitList();
  assert(await root.locator(".st-browser-empty").innerText() === "No notebooks or folders here.", `${platform}: empty folder state missing`);
  await root.locator(".st-browser-parent").click();
  await waitList();
  const notesRoot = (await fixture()).paths.working.replace(/\/Journal\/Reflection\.note$/, "");
  await page.evaluate(path => { window.__streamlinedListingFailure = `${path}/Unavailable`; }, notesRoot);
  await root.getByRole("button", { name: "Open folder Unavailable" }).click();
  await root.locator(".st-browser-load-error").waitFor();
  await page.evaluate(() => { window.__streamlinedListingFailure = ""; });
  await root.getByRole("button", { name: "Retry" }).click();
  await waitList();
  assert(await root.locator(".st-browser-empty").count() === 1, `${platform}: retry did not recover to the empty state`);

  await openPickerAtNotes("add-source");
  await root.getByRole("button", { name: "Open folder Loose" }).click();
  await waitList();
  await root.getByRole("button", { name: "Select notebook Loose notebook.note" }).click();
  const fileTarget = await root.locator(".st-source-picker-add").getAttribute("data-source-target");
  assert(fileTarget.endsWith("Loose notebook.note"), `${platform}: selected file is not the footer target: ${fileTarget}`);
  await root.locator(".st-source-picker-add").click();
  await page.waitForFunction(() => document.querySelector(".st-fullscreen-modal .st-sources-list"));
  let counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
  assert(counters.sourceRegistrations.length === 1 && counters.sourceRegistrations[0].kind === "file" && counters.sourceRegistrations[0].status === "added", `${platform}: selected file did not register using defaults`);
  assert(counters.update === 0 && counters.recognitionNow.length === 0, `${platform}: adding a source queued recognition`);

  await openPickerAtNotes("add-source");
  await root.getByRole("button", { name: "Open folder Extra" }).click();
  await waitList();
  await root.locator(".st-source-picker-add").click();
  await page.waitForFunction(() => document.querySelector(".st-fullscreen-modal .st-sources-list"));
  counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
  assert(counters.sourceRegistrations.length === 2 && counters.sourceRegistrations[1].kind === "folder" && counters.sourceRegistrations[1].status === "added", `${platform}: current folder footer did not add a folder source`);
  assert(counters.update === 0 && counters.recognitionNow.length === 0, `${platform}: folder registration queued recognition`);

  await openPickerAtNotes("add-source");
  await root.getByRole("button", { name: "Open folder Journal" }).click();
  await waitList();
  await root.getByRole("button", { name: "Select notebook Reflection.note" }).click();
  await root.locator(".st-source-picker-add").click();
  await root.locator(".st-source-section").waitFor();
  counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
  assert(counters.sourceRegistrations.at(-1).status === "overlap", `${platform}: overlapping selection was not routed through the existing rule`);
  assert(await root.locator(".st-source-title").innerText() === "Journal", `${platform}: overlap did not open the owning source configuration`);
  await root.locator(".st-back").click();
  await openPickerAtNotes("add-source");
  await root.getByRole("button", { name: "Open folder Loose" }).click();
  await waitList();
  await root.getByRole("button", { name: "Select notebook Loose notebook.note" }).click();
  await root.locator(".st-source-picker-add").click();
  await root.locator(".st-source-section").waitFor();
  counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
  assert(counters.sourceRegistrations.at(-1).status === "existing", `${platform}: duplicate selection was not routed to its existing configuration`);
  assert((await page.evaluate(() => window.__streamlinedFixture.controller.config.rules.length)) === 4, `${platform}: duplicate or overlap created another source rule`);
  await root.locator(".st-back").click();

  await openPickerAtNotes("transcribe-selection");
  await root.getByRole("button", { name: "Open folder Archive" }).click();
  await waitList();
  await root.locator(".st-run-options > summary").click();
  const recursion = root.getByRole("combobox", { name: "Folder contents" });
  await recursion.selectOption("true");
  await root.getByRole("textbox", { name: "Transcript folder inside this vault" }).fill("Custom/Transcripts");
  await root.getByRole("combobox", { name: "Recognition profile" }).selectOption("research-profile");
  await root.getByRole("combobox", { name: "Recognition prompt" }).selectOption(JSON.stringify(["recognition-exact", 2]));
  await root.locator(".st-browser-parent").click();
  await waitList();
  await root.getByRole("button", { name: "Open folder Archive" }).click();
  await waitList();
  assert(await root.locator(".st-run-options").getAttribute("open") !== null, `${platform}: Run options collapsed during folder navigation`);
  assert(await root.getByRole("combobox", { name: "Folder contents" }).inputValue() === "true", `${platform}: recursion option was lost during folder navigation`);
  assert(await root.getByRole("textbox", { name: "Transcript folder inside this vault" }).inputValue() === "Custom/Transcripts", `${platform}: destination option was lost during folder navigation`);
  assert(await root.getByRole("combobox", { name: "Recognition profile" }).inputValue() === "research-profile", `${platform}: profile option was lost during folder navigation`);
  assert(await root.getByRole("combobox", { name: "Recognition prompt" }).inputValue() === JSON.stringify(["recognition-exact", 2]), `${platform}: exact prompt revision was lost during folder navigation`);
  await root.locator(".st-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(screenshots, `${platform}-transcribe-picker.png`) });
  await root.locator(".st-source-picker-transcribe").click();
  await root.locator(".st-queue-live").waitFor();
  counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
  assert(counters.transcriptionSelections.length === 1 && counters.transcriptionSelections[0].kind === "folder", `${platform}: folder transcription was not submitted exactly once`);
  assert(JSON.stringify(counters.transcriptionSelections[0].options) === JSON.stringify({ recursive: true, output: "Custom/Transcripts", profileId: "research-profile", prompt: { id: "recognition-exact", revision: 2 } }), `${platform}: folder run options were not scoped to the request: ${JSON.stringify(counters.transcriptionSelections[0].options)}`);
  assert(counters.update === 0 && counters.recognitionNow.length === 0, `${platform}: Transcribe also invoked the saved Update flow`);

  await openPickerAtNotes("transcribe-selection");
  await root.getByRole("button", { name: "Open folder Extra" }).click();
  await waitList();
  await root.locator(".st-run-options > summary").click();
  assert(await root.getByRole("textbox", { name: "Transcript folder inside this vault" }).count() === 0, `${platform}: destination override was shown for a configured source`);
  assert(await root.getByRole("combobox", { name: "Recognition profile" }).inputValue() === "", `${platform}: run options did not reset when the picker reopened`);
  assert(await root.getByRole("combobox", { name: "Recognition prompt" }).inputValue() === "", `${platform}: prompt selection did not reset when the picker reopened`);
  await root.getByRole("button", { name: "Select notebook New fixture notebook.note" }).click();
  const transcribeTarget = await root.locator(".st-source-picker-transcribe").getAttribute("data-source-target");
  assert(transcribeTarget.endsWith("New fixture notebook.note"), `${platform}: selected notebook is not the Transcribe target`);
  await root.locator(".st-source-picker-transcribe").click();
  await root.locator(".st-queue-live").waitFor();
  counters = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters);
  assert(counters.transcriptionSelections.length === 2 && counters.transcriptionSelections[1].kind === "file", `${platform}: Transcribe did not call the scoped selection port`);
  assert(counters.transcriptionSelections[1].path.endsWith("Extra/New fixture notebook.note"), `${platform}: Transcribe used an unexpected path`);
  assert(Object.keys(counters.transcriptionSelections[1].options).length === 0, `${platform}: reopened Transcribe inherited previous run options`);
  assert(counters.update === 0 && counters.recognitionNow.length === 0, `${platform}: Transcribe also invoked the saved Update flow`);

  if (platform === "desktop") {
    const fileMenu = (target, folder = false) => page.evaluate(({ target, folder }) => {
      const items = [];
      const menu = { addItem(callback) {
        const item = { title: "", onSelect: undefined,
          setTitle(value) { this.title = value; return this; },
          setIcon() { return this; }, onClick(callback) { this.onSelect = callback; return this; } };
        callback(item); items.push(item);
      } };
      window.__streamlinedFixture.workspaceEvents.get("file-menu")(menu, { path: target, ...(folder ? { children: [] } : {}) }, "file-explorer");
      items[0]?.onSelect?.();
      return items[0]?.title;
    }, { target, folder });
    const title = await fileMenu("Notes/Extra/New fixture notebook.note");
    assert(title === "Transcribe this notebook", `desktop: notebook file-menu action missing: ${title}`);
    await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.transcriptionSelections.length === 3);
    const selection = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.transcriptionSelections.at(-1));
    assert(selection.path === "C:/UX Fixture/Notes/Extra/New fixture notebook.note" && selection.kind === "file", `desktop: explorer action did not resolve the clicked file's absolute path: ${JSON.stringify(selection)}`);
    const folderTitle = await fileMenu("Notes/Extra", true);
    assert(folderTitle === "Transcribe this folder", `desktop: folder file-menu action missing: ${folderTitle}`);
    await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.transcriptionSelections.length === 4);
    const folderSelection = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.transcriptionSelections.at(-1));
    assert(folderSelection.path === "C:/UX Fixture/Notes/Extra" && folderSelection.kind === "folder", `desktop: folder explorer action did not use the selected local folder: ${JSON.stringify(folderSelection)}`);
    assert(await fileMenu("", true) === undefined, "desktop: vault-root explorer context unexpectedly received a Transcribe action");
  }

  await page.evaluate(() => {
    const fixture = window.__streamlinedFixture;
    const original = fixture.controller.store.notebooks[fixture.paths.working];
    const state = structuredClone(original);
    state.source = original.source.replace(/\/Journal\/Reflection\.note$/, "/One-time/Standalone.note");
    state.ruleId = "one-time:fixture-working";
    state.oneTime = { profileId: "general" };
    state.publishedHash = "fixture-publication";
    state.output = "Fixture Output/Standalone.md";
    for (const page of state.desired) state.pages[page.id] = { fingerprint: page.fingerprint, text: `Fixture page ${page.number}`, recipe: "fixture", number: page.number };
    state.status = "current";
    fixture.controller.store.notebooks[state.source] = state;
    fixture.controller.aiEnabled = true;
    fixture.controller.progress.running = false;
    fixture.controller.notify();
  });
  const oneTime = root.locator(".st-queue-one-time");
  assert((await oneTime.innerText()).includes("Standalone"), `${platform}: completed one-time result is not reachable from Queue`);
  await oneTime.getByRole("button", { name: "Details", exact: true }).click();
  await root.locator(".st-detail-live").waitFor();
  await root.locator(".st-cleanup-open").click();
  await root.locator(".st-cleanup-workflow").waitFor();
  await root.getByRole("combobox", { name: "Cleanup prompt" }).selectOption(JSON.stringify(["cleanup-exact", 2]));
  await page.screenshot({ path: join(screenshots, `${platform}-cleanup.png`) });
  let cleanupOptions = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.cleanupEstimates.at(-1)?.options);
  assert(cleanupOptions?.prompt?.id === "cleanup-exact" && cleanupOptions.prompt.revision === 2, `${platform}: cleanup estimate did not receive the exact prompt revision: ${JSON.stringify(cleanupOptions)}`);
  await root.locator(".st-cleanup-run").click();
  await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.cleanupRuns.length === 1);
  cleanupOptions = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.cleanupRuns[0].options);
  assert(cleanupOptions?.prompt?.id === "cleanup-exact" && cleanupOptions.prompt.revision === 2, `${platform}: cleanup did not run with the exact prompt revision: ${JSON.stringify(cleanupOptions)}`);
  await root.locator(".st-reprocess-open").click();
  await root.getByRole("button", { name: "Select page 2", exact: true }).click();
  assert(await root.getByRole("textbox", { name: "Pages", exact: true }).inputValue() === "2", `${platform}: preview card did not update the page range`);
  await page.screenshot({ path: join(screenshots, `${platform}-re-recognize.png`) });
  await root.getByRole("button", { name: "Re-recognize selected pages", exact: true }).click();
  await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.reprocessRuns.length === 1);
  const rerun = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.reprocessRuns[0]);
  assert(rerun.source.endsWith("One-time/Standalone.note") && rerun.range === "2" && !rerun.outdatedOnly, `${platform}: re-recognition dispatched an unexpected scope: ${JSON.stringify(rerun)}`);
  await root.getByRole("button", { name: "Check & update", exact: true }).click();
  const standaloneUpdate = await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.transcriptionSelections.at(-1));
  assert(standaloneUpdate.path.endsWith("One-time/Standalone.note") && standaloneUpdate.kind === "file", `${platform}: one-time notebook details did not use scoped update`);
  await root.getByRole("button", { name: "Back", exact: true }).click();
  await oneTime.getByRole("button", { name: "Open transcript", exact: true }).click();
  assert(await page.evaluate(() => window.__streamlinedFixture.controller.actionCounters.openedOutputs.at(-1)) === "Fixture Output/Standalone.md", `${platform}: Queue did not open the saved transcript`);

  let activityIssueNavigation = false;
  if (platform === "desktop") {
    await page.evaluate(() => {
      const fixture = window.__streamlinedFixture;
      const state = fixture.controller.store.notebooks[fixture.paths.attention];
      state.oneTime = { profileId: "general" };
      state.ruleId = "one-time:fixture";
      fixture.controller.notify();
    });
    await page.evaluate(() => window.__streamlinedFixture.statusBarItem.click());
    const activity = page.locator(".st-activity-modal");
    await activity.waitFor();
    const issueAction = activity.locator(".st-activity-issues button").first();
    assert(await issueAction.count() > 0, "desktop: the Activity fixture must expose an issue action");
    await issueAction.click();
    await activity.waitFor({ state: "detached" });
    await root.locator(".st-source-title").waitFor();
    assert(await root.locator(".st-source-title").innerText() === "Research", "desktop: explicit source issue rule ID did not open Configure for its owner");
    await root.locator(".st-back").click();

    await page.evaluate(() => window.__streamlinedFixture.statusBarItem.click());
    const nextActivity = page.locator(".st-activity-modal");
    await nextActivity.waitFor();
    const pageIssue = nextActivity.locator(".st-activity-issues button").nth(1);
    assert(await pageIssue.count() > 0, "desktop: the one-time page issue fixture is missing");
    await pageIssue.click();
    await nextActivity.waitFor({ state: "detached" });
    await root.locator(".st-detail-live").waitFor();
    assert((await root.innerText()).includes("Failed"), `${platform}: one-time Activity issue did not open notebook details`);
    activityIssueNavigation = true;
    assert(activityIssueNavigation, "desktop: Activity issue did not open its owning view");
  }

  assert(errors.length === 0, `${platform}: browser errors: ${errors.join("; ")}`);
  reports.push({ platform, foldersFirst: true, keyboardNavigation: true, emptyAndRetryStates: true, fileAndFolderRegistration: true, registrationDidNotStartRecognition: true, scopedTranscribe: true, runOptions: true, publishedOneTimeResult: true, cleanupAndReRecognition: true, desktopExplorerFileAndFolderPaths: platform === "desktop", activitySourceAndOneTimeIssueNavigation: activityIssueNavigation });
  await browser.close();
}

const evidence = { verification: "headless Chromium picker workflow", syntheticDataOnly: true, network: false, reports };
const evidencePath = resolve(rootPath, "test-artifacts/source-picker-ui-evidence.json");
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
