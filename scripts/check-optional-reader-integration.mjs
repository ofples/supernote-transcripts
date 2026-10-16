import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const argReader = process.argv.indexOf("--reader");
const readerPath = resolve(argReader >= 0 ? process.argv[argReader + 1] :
  process.env.MD_READER_PATH || resolve(here, "../../md-reader/main.js"));
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (localError) {
  const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT;
  if (!moduleRoot) throw new Error("Playwright is not resolvable; install it or set PLAYWRIGHT_MODULE_ROOT", { cause: localError });
  ({ chromium } = require(join(resolve(moduleRoot), "playwright")));
}

const source = await readFile(readerPath, "utf8") +
  "\nmodule.exports.__fixture = { ReaderView };\n";
const obsidian = {
  Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, Scope: class {}, Component: class {},
  Platform: { isMobile: false, isDesktop: true }, TFile: class {}, Notice: class {}, MarkdownRenderer: {},
  SuggestModal: class {}, Modal: class {}, Menu: class {}, TFolder: class {},
};
const module_ = { exports: {} };
new vm.Script(`(function(require,module,exports){${source}\n})`, { filename: readerPath })
  .runInThisContext()((name) => {
    if (name === "obsidian") return obsidian;
    throw new Error(`Unexpected reader dependency: ${name}`);
  }, module_, module_.exports);
const renderMethodSource = module_.exports.__fixture.ReaderView.prototype.renderChapterMarkdown.toString();

const mockModules = {
  obsidian: `
    export const editorInfoField = {};
    export const editorLivePreviewField = {};
    export class MarkdownRenderChild {}
    export class MarkdownView {}
    export class TFile { static [Symbol.hasInstance](value) { return value?.isTFile === true; } }
    function inline(parent, value) {
      const pattern = /\\[([^\\]]+)\\]\\(([^)]+)\\)/g;
      let offset = 0;
      for (const match of value.matchAll(pattern)) {
        parent.append(document.createTextNode(value.slice(offset, match.index)));
        const anchor = document.createElement("a"); anchor.href = match[2]; anchor.textContent = match[1]; parent.append(anchor);
        offset = match.index + match[0].length;
      }
      parent.append(document.createTextNode(value.slice(offset)));
    }
    export const MarkdownRenderer = { async render(_app, markdown, target) {
      for (const line of markdown.split(/\\r?\\n/)) {
        if (!line.trim()) continue;
        const heading = line.match(/^ {0,3}(#{1,6})\\s+(.*)$/);
        const el = document.createElement(heading ? "h" + heading[1].length : "p");
        inline(el, heading ? heading[2] : line);
        target.append(el);
      }
    } };
  `,
  "@codemirror/view": `export class Decoration { static replace(x){return x} static widget(x){return x} } export class EditorView { static decorations={from(){}} } export class ViewPlugin { static fromClass(x){return x} } export class WidgetType {}`,
  "@codemirror/state": `export class RangeSetBuilder { add(){} finish(){return []} } export class StateEffect { static define(){return {of(value){return {value}},is(){return false}}} } export class StateField { static define(value){return value} }`,
};
const providerBundle = await build({
  entryPoints: [resolve(here, "../src/page-links-ui.ts")], bundle: true, platform: "browser", format: "iife",
  globalName: "TranscriptPageLinks", write: false,
  plugins: [{ name: "mock-obsidian-and-codemirror", setup(api) {
    api.onResolve({ filter: /^(obsidian|@codemirror\/view|@codemirror\/state)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mockModules[args.path], loader: "js" }));
  } }],
});

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: resolve(process.env.CHROME_EXECUTABLE_PATH) } : {}),
});
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error)));
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: providerBundle.outputFiles[0].text });
  const result = await page.evaluate(async ({ renderMethodSource }) => {
    const canonical = ["---", "nomad_transcripts: true", "---", "", "# Chapter",
      "<!-- supernote-page:native%3Afirst number:1 -->", "Transcript sentence."].join("\n");
    const file = { path: "Transcripts/fixture.md", extension: "md", isTFile: true };
    let ordinaryCalls = 0;
    window.MarkdownRenderer = { async render(_app, markdown, target) {
      ordinaryCalls++;
      for (const line of markdown.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const heading = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
        const el = document.createElement(heading ? "h" + heading[1].length : "p");
        el.textContent = heading ? heading[2] : line;
        target.append(el);
      }
    } };
    const callbacks = [];
    const plugin = {
      app: { vault: { getAbstractFileByPath: path => path === file.path ? file : null, cachedRead: async () => canonical },
        workspace: { updateOptions() {}, getLeavesOfType() { return []; } }, plugins: { plugins: {} } },
      register(callback) { callbacks.push(callback); }, registerEditorExtension() {}, registerMarkdownPostProcessor() {},
    };
    plugin.app.plugins.plugins["nomad-transcripts"] = plugin;
    const chapterMarkdown = "# Chapter\n<!-- supernote-page:native%3Afirst number:1 -->\nTranscript sentence.";
    let providerSection;
    const captureProviderSection = () => {
      const renderSection = plugin.pageLinks.renderSection;
      plugin.pageLinks.renderSection = section => { providerSection = section; return renderSection(section); };
    };
    const ordinary = async () => {
      const target = document.createElement("div");
      await render.call({ app: plugin.app, file, chapterSourceLineMaps: [[4, 5, 6]] }, 0, chapterMarkdown, target, {});
      return { target, text: target.textContent };
    };
    const render = eval(`({${renderMethodSource}}).renderChapterMarkdown`);
    TranscriptPageLinks.installPageLinks(plugin, async () => {}, () => true);
    captureProviderSection();
    const linked = await ordinary();
    const linkedCount = linked.target.querySelectorAll("button.st-page-link").length;
    const canonicalLineMap = [4, 5, 6];
    callbacks.shift()(); // Provider unload removes its API and notifies the reader.
    const unloaded = await ordinary();

    TranscriptPageLinks.installPageLinks(plugin, async () => {}, () => false);
    const disabled = await ordinary();
    const disabledApi = plugin.pageLinks;
    plugin.pageLinks = { ...disabledApi, apiVersion: 2, enabled: () => true,
      renderSection: async () => { throw new Error("unsupported version must not run"); } };
    const unsupported = await ordinary();
    plugin.pageLinks = { ...disabledApi, enabled: () => true,
      async renderSection({ element }) { element.append(document.createElement("span")).textContent = "Transcript sentence."; throw new Error("fixture failure"); } };
    const throwing = await ordinary();
    return {
      linkedCount, linkedText: linked.text, received: providerSection && {
        sourcePath: providerSection.sourcePath, markdown: providerSection.markdown, sourceLineMap: providerSection.sourceLineMap,
      },
      unloaded: { chips: unloaded.target.querySelectorAll("button.st-page-link").length, text: unloaded.text },
      disabled: { chips: disabled.target.querySelectorAll("button.st-page-link").length, text: disabled.text },
      unsupported: { chips: unsupported.target.querySelectorAll("button.st-page-link").length, text: unsupported.text },
      throwing: { chips: throwing.target.querySelectorAll("button.st-page-link").length, text: throwing.text },
      ordinaryCalls,
    };
  }, { renderMethodSource });
  assert.deepEqual(pageErrors, []);
  assert.equal(result.linkedCount, 1);
  assert.match(result.linkedText, /Transcript sentence\./);
  assert.deepEqual(result.received, {
    sourcePath: "Transcripts/fixture.md",
    markdown: "# Chapter\n<!-- supernote-page:native%3Afirst number:1 -->\nTranscript sentence.",
    sourceLineMap: [4, 5, 6],
  });
  for (const scenario of ["unloaded", "disabled", "unsupported", "throwing"]) {
    assert.equal(result[scenario].chips, 0, `${scenario} leaves no chips`);
    const matches = result[scenario].text.match(/Transcript sentence\./g) || [];
    assert.equal(matches.length, 1, `${scenario} fallback renders source text once`);
  }
  assert.equal(result.ordinaryCalls, 4);
  console.log(`Optional MD Reader integration passed against ${readerPath}`);
} finally {
  await browser.close();
}
