import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch (localError) {
  const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT;
  if (!moduleRoot) throw new Error("Playwright is not resolvable; install it locally or set PLAYWRIGHT_MODULE_ROOT", { cause: localError });
  ({ chromium } = require(join(resolve(moduleRoot), "playwright")));
}
const chrome = process.env.CHROME_EXECUTABLE_PATH ? resolve(process.env.CHROME_EXECUTABLE_PATH) : undefined;
const screenshotFolder = resolve(root, "test-artifacts/streamlined-ui-screenshots");
await mkdir(screenshotFolder, { recursive: true });
for (const platform of ["desktop", "nomad"]) execFileSync(process.execPath, ["scripts/build-streamlined-ui-fixture.mjs", `--platform=${platform}`], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });

const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
const reports = [];
try {
  for (const viewport of [{ platform: "desktop", width: 1120, height: 820 }, { platform: "nomad", width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(pathToFileURL(resolve(root, `private/ux-streamline/build/${viewport.platform}/index.html`)).href);
    await page.locator(".st-fullscreen-modal").waitFor();
    await page.locator(".st-fullscreen-modal .st-close").click();
    await page.evaluate(() => {
      const { controller, settingTab } = window.__streamlinedFixture;
      controller.apiKey = "";
      document.body.append(settingTab.containerEl);
      settingTab.display();
    });
    const settings = page.locator(".st-fullscreen-modal.st-native-settings");
    await settings.waitFor();
    assert.equal(await page.locator("body > .modal-container:not(.st-native-settings)").count(), 0, `${viewport.platform}: Settings rendered a detached modal`);
    for (const label of ["Connection", "Recognition", "Updates", "Storage"]) assert.equal(await settings.getByRole("tab", { name: label, exact: true }).count(), 1, `${viewport.platform}: ${label} tab missing`);
    assert.equal(await settings.getByRole("textbox", { name: "Default transcript folder" }).inputValue(), "Supernote Transcripts", `${viewport.platform}: default output field missing`);
    assert.equal(await settings.getByText("No API key saved", { exact: true }).count(), 1, `${viewport.platform}: missing connection setup status`);
    const geometry = await settings.evaluate(element => ({ fixed: getComputedStyle(element).position === "fixed", scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, width: element.getBoundingClientRect().width }));
    assert.equal(geometry.fixed, false, `${viewport.platform}: native settings root remains viewport fixed`);
    const overflow = geometry.scrollWidth > geometry.clientWidth + 1 ? await settings.evaluate(element => [...element.querySelectorAll("*")].map(node => ({ tag: node.tagName, cls: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })).filter(node => node.scrollWidth > node.clientWidth + 1).slice(0, 12)) : [];
    assert(geometry.scrollWidth <= geometry.clientWidth + 1, `${viewport.platform}: horizontal overflow ${JSON.stringify({ geometry, overflow })}`);
    await page.screenshot({ path: join(screenshotFolder, `${viewport.platform}-native-settings.png`) });

    const defaultFolder = settings.getByRole("textbox", { name: "Default transcript folder" });
    const toolbar = page.locator(".st-native-settings-toolbar");
    await defaultFolder.fill("Unsaved Folder");
    await toolbar.getByRole("button", { name: "Open Sources" }).click();
    await settings.getByRole("heading", { name: "Sources", exact: true }).waitFor();
    await settings.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(await defaultFolder.inputValue(), "Unsaved Folder", `${viewport.platform}: visiting Sources cleared the native settings draft`);
    await toolbar.getByRole("button", { name: "Add source", exact: true }).click();
    await settings.getByRole("heading", { name: "Add source", exact: true }).waitFor();
    await settings.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(await defaultFolder.inputValue(), "Unsaved Folder", `${viewport.platform}: visiting the picker cleared the native settings draft`);

    await settings.getByRole("tab", { name: "Storage" }).click();
    await settings.getByRole("button", { name: "Review storage" }).click();
    await settings.getByRole("button", { name: "Back" }).click();
    assert(await settings.getByRole("tab", { name: "Storage" }).getAttribute("aria-selected") === "true", `${viewport.platform}: storage navigation did not return to its settings tab`);
    await settings.getByRole("tab", { name: "Connection" }).click();
    await settings.getByRole("button", { name: "Review Costs" }).click();
    assert.equal(await settings.getByRole("heading", { name: "Costs" }).count(), 1, `${viewport.platform}: Costs route missing`);
    await settings.getByRole("button", { name: "Cancel" }).click();
    assert(await settings.getByRole("tab", { name: "Connection" }).getAttribute("aria-selected") === "true", `${viewport.platform}: Costs cancel lost settings context`);
    await settings.getByRole("button", { name: "Choose folder" }).click();
    await settings.locator(".st-output-browser .st-browser-entry").first().waitFor();
    await settings.getByRole("button", { name: "Fixture Output" }).click();
    assert.equal(await settings.getByRole("heading", { name: "Choose default transcript folder" }).count(), 1, `${viewport.platform}: default output picker route missing`);
    await settings.getByRole("button", { name: "Cancel" }).click();
    assert(await settings.getByRole("tab", { name: "Connection" }).getAttribute("aria-selected") === "true", `${viewport.platform}: default folder cancel lost settings context`);

    await settings.getByRole("tab", { name: "Recognition" }).click();
    await settings.getByRole("button", { name: "Open prompt library" }).click();
    const library = settings.locator(".st-prompt-library");
    assert.equal(await library.count(), 1, `${viewport.platform}: prompt library did not stay in Settings`);
    const libraryContent = library;
    assert(await libraryContent.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${viewport.platform}: prompt library has horizontal overflow`);
    const promptName = library.getByRole("textbox", { name: "Prompt name", exact: true });
    const promptText = library.getByRole("textbox", { name: "Prompt text", exact: true });
    const revisions = library.getByRole("combobox", { name: "Saved recognition revisions", exact: true });
    const promptFooter = settings.locator(".st-prompt-footer");
    const createPrompt = promptFooter.getByRole("button", { name: "Create prompt", exact: true });
    assert(await createPrompt.isDisabled(), `${viewport.platform}: an empty prompt can be saved`);
    await promptName.fill("Fixture review prompt");
    await promptText.fill("Keep the original wording.");
    await createPrompt.click();
    await library.getByText("Saved as a new immutable revision.", { exact: true }).waitFor();
    const [promptId, firstRevision] = JSON.parse(await revisions.inputValue());
    assert.equal(firstRevision, 1, `${viewport.platform}: a new prompt did not start at revision 1`);
    await promptText.fill("Keep the original wording and headings.");
    await promptFooter.getByRole("button", { name: "Save as new revision" }).click();
    await library.getByText("Saved as a new immutable revision.", { exact: true }).waitFor();
    assert.equal(await revisions.inputValue(), JSON.stringify([promptId, 2]), `${viewport.platform}: editing did not create revision 2`);
    await revisions.selectOption(JSON.stringify([promptId, 1]));
    assert.equal(await promptText.inputValue(), "Keep the original wording.", `${viewport.platform}: revising mutated the original text`);
    await library.getByRole("textbox", { name: "Duplicate prompt name" }).fill("Fixture duplicate");
    await library.getByRole("button", { name: "Duplicate selected revision" }).click();
    await library.getByText("Created a separate prompt with a new history.", { exact: true }).waitFor();
    assert.equal(await promptName.inputValue(), "Fixture duplicate", `${viewport.platform}: duplicate was not saved`);
    assert.notEqual(JSON.parse(await revisions.inputValue())[0], promptId, `${viewport.platform}: duplicate reused the original prompt ID`);
    await library.getByRole("combobox", { name: "Prompt category" }).selectOption("cleanup");
    const cleanupRevisions = library.getByRole("combobox", { name: "Saved cleanup revisions" });
    await cleanupRevisions.selectOption(JSON.stringify(["cleanup-exact", 2]));
    await library.getByRole("button", { name: "Use as cleanup default" }).click();
    await library.getByText("Default cleanup: Exact cleanup run · v2", { exact: true }).waitFor();
    await library.getByRole("button", { name: "Reset default" }).click();
    await library.getByText("No cleanup prompt default is selected.", { exact: true }).waitFor();
    await library.getByRole("button", { name: "Use as cleanup default" }).click();
    await library.getByText("Default cleanup: Exact cleanup run · v2", { exact: true }).waitFor();
    await libraryContent.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: join(screenshotFolder, `${viewport.platform}-prompt-library.png`) });
    await settings.getByRole("button", { name: "Back", exact: true }).click();
    await settings.locator(".st-cleanup-defaults > summary").click();
    assert.equal(await settings.getByRole("textbox", { name: "Default cleanup instructions" }).inputValue(), "Keep every quoted section verbatim.", `${viewport.platform}: Settings did not refresh the cleanup default`);

    await settings.getByRole("tab", { name: "Connection" }).click();
    const outputBefore = await page.evaluate(() => window.__streamlinedFixture.controller.config.rules.map(rule => rule.output));
    await settings.getByRole("textbox", { name: "Default transcript folder" }).fill("New Default Output");
    await settings.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() => window.__streamlinedFixture.controller.actionCounters.saveConfig === 1);
    const saved = await page.evaluate(() => ({ defaultOutput: window.__streamlinedFixture.controller.config.defaultOutput, cleanupPrompt: window.__streamlinedFixture.controller.config.cleanupPrompt, outputs: window.__streamlinedFixture.controller.config.rules.map(rule => rule.output), saves: window.__streamlinedFixture.controller.actionCounters.saveConfig }));
    assert.equal(saved.defaultOutput, "New Default Output", `${viewport.platform}: default output did not save`);
    assert.equal(saved.cleanupPrompt, "Keep every quoted section verbatim.", `${viewport.platform}: saving unrelated Settings replaced the library default`);
    assert.deepEqual(saved.outputs, outputBefore, `${viewport.platform}: existing source output changed`);
    assert.equal(saved.saves, 1, `${viewport.platform}: unexpected config save count`);
    assert.deepEqual(errors, [], `${viewport.platform}: runtime errors ${JSON.stringify(errors)}`);
    reports.push({ ...viewport, geometry, saved, errors });
    await page.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ passed: reports.length, reports }, null, 2));
