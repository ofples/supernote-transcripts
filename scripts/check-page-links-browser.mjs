import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { join } from "node:path";

const moduleRoot = "C:/Users/pless/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(import.meta.url);
const { chromium } = require(join(moduleRoot, "playwright"));

const mocks = {
  obsidian: `
    export const editorInfoField = {};
    export const editorLivePreviewField = {};
    export class MarkdownRenderChild { constructor() {} }
    export class MarkdownView {}
    export class Notice {}
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
    function startBlock(line) { return /^ {0,3}#{1,6}\\s|^\\s*\\|.*\\|\\s*$|^\\s*(?:[-+*]|\\d+[.)])\\s|^\\s*$/.test(line); }
    export const MarkdownRenderer = { async render(_app, markdown, target) {
      const lines = markdown.split(/\\r?\\n/); let i = 0;
      while (i < lines.length) {
        const line = lines[i]; if (!line.trim()) { i++; continue; }
        const heading = line.match(/^ {0,3}(#{1,6})\\s+(.*)$/);
        if (heading) { const el = document.createElement("h" + heading[1].length); inline(el, heading[2]); target.append(el); i++; continue; }
        if (/^\\s*\\|.*\\|\\s*$/.test(line)) {
          const table = document.createElement("table"), body = document.createElement("tbody");
          while (i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])) {
            if (/^\\s*\\|?\\s*:?-{3,}:?\\s*(?:\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(lines[i])) { i++; continue; }
            const row = document.createElement("tr");
            for (const raw of lines[i].trim().replace(/^\\||\\|$/g, "").split("|")) { const cell = document.createElement("td"); inline(cell, raw.trim()); row.append(cell); }
            body.append(row); i++;
          }
          table.append(body); target.append(table); continue;
        }
        if (/^\\s*(?:[-+*]|\\d+[.)])\\s/.test(line)) {
          const list = document.createElement("ul");
          while (i < lines.length && /^\\s*(?:[-+*]|\\d+[.)])\\s/.test(lines[i])) { const item = document.createElement("li"); inline(item, lines[i].replace(/^\\s*(?:[-+*]|\\d+[.)])\\s+/, "")); list.append(item); i++; }
          target.append(list); continue;
        }
        const paragraph = [line]; i++;
        while (i < lines.length && !startBlock(lines[i])) paragraph.push(lines[i++]);
        const p = document.createElement("p"); inline(p, paragraph.join(" ")); target.append(p);
      }
    } };
  `,
  "@codemirror/view": `export class Decoration { static replace(x){return x} static widget(x){return x} } export class EditorView { static decorations={from(){}} } export class ViewPlugin { static fromClass(x){return x} } export class WidgetType {}`,
  "@codemirror/state": `export class RangeSetBuilder { add(){} finish(){return []} } export class StateEffect { static define(){return {of(value){return {value}},is(){return false}}} } export class StateField { static define(value){return value} }`,
};

const bundle = await build({
  entryPoints: ["src/page-links-ui.ts"], bundle: true, platform: "browser", format: "iife", globalName: "PageLinksBrowserBundle", write: false,
  plugins: [{ name: "local-browser-mocks", setup(api) {
    api.onResolve({ filter: /^(obsidian|@codemirror\/view|@codemirror\/state)$/ }, args => ({ path: args.path, namespace: "browser-mock" }));
    api.onLoad({ filter: /.*/, namespace: "browser-mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }],
});

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
test("reader page chips use real DOM blocks without creating chip-only paragraphs", async (t) => {
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setContent("<!doctype html><html><body><main id='root'></main></body></html>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const canonicalLines = [
      "---", "nomad_transcripts: true", "---", "", "# Same", "<!-- supernote-page:first number:1 -->", "Same duplicated text.", "",
      "# Same", "<!-- supernote-page:second number:2 -->", "Same duplicated text.", "", "<!-- supernote-page:list number:3 -->", "- list item", "",
      "<!-- supernote-page:table number:4 -->", "| Header | Other |", "|---|---|", "| cell | value |", "", "Ending prose.",
      "Inline starts <!-- supernote-page:inline number:6 --> ends.", "", "<!-- supernote-page:eof number:5 -->",
    ];
    const canonical = canonicalLines.join("\n");
    const file = { path: "Transcripts/fixture.md", extension: "md", isTFile: true };
    const openCalls = [];
    const plugin = {
      app: { vault: { getAbstractFileByPath: path => path === file.path ? file : null, cachedRead: async () => canonical }, workspace: { updateOptions(){}, getLeavesOfType(){return []} } },
      register() {}, registerEditorExtension() {}, registerMarkdownPostProcessor() {},
    };
    PageLinksBrowserBundle.installPageLinks(plugin, async (...args) => openCalls.push(args), () => true);
    const render = async (lines, start = canonicalLines.indexOf(lines[0])) => {
      const text = lines.join("\n");
      const sourceLineMap = lines.map((_line, index) => start + index);
      const element = document.createElement("div");
      const ok = await plugin.pageLinks.renderSection({ element, sourcePath: file.path, markdown: text, sourceLineMap, component: {} });
      return { ok, element, map: sourceLineMap };
    };
    const first = await render(["# Same", "<!-- supernote-page:first number:1 -->", "Same duplicated text."], 4);
    const second = await render(["# Same", "<!-- supernote-page:second number:2 -->", "Same duplicated text."], 8);
    const blocks = await render(canonicalLines.slice(4));
    const allParagraphs = [...blocks.element.querySelectorAll("p")];
    const chipOnlyParagraphs = allParagraphs.filter(p => [...p.childNodes].every(node =>
      node.nodeType === Node.TEXT_NODE ? !node.textContent.trim() : node.nodeType === Node.ELEMENT_NODE && node.matches("span.st-page-link-group,button.st-page-link")));
    const chips = [...blocks.element.querySelectorAll("button.st-page-link")];
    const inlineChip = [...blocks.element.querySelectorAll("p")].find(p => p.textContent.includes("Inline starts"));
    const listChip = blocks.element.querySelector("li .st-page-link-group");
    const tableChip = blocks.element.querySelector("td .st-page-link-group");
    const eofChip = [...blocks.element.querySelectorAll("p")].find(p => p.textContent.includes("Ending prose"))?.querySelector(".st-page-link-group");
    return {
      firstOk: first.ok, secondOk: second.ok, blockOk: blocks.ok,
      first: first.element.querySelector(".st-page-link")?.textContent,
      second: second.element.querySelector(".st-page-link")?.textContent,
      chipCount: chips.length, chipOnlyParagraphs: chipOnlyParagraphs.length,
      inlineChip: !!inlineChip?.querySelector(".st-page-link"), listChip: !!listChip, tableChip: !!tableChip, eofChip: !!eofChip,
      paragraphCount: allParagraphs.length,
    };
  });
  assert.deepEqual(errors, []);
  assert.equal(result.firstOk, true); assert.equal(result.secondOk, true); assert.equal(result.blockOk, true);
  assert.equal(result.first, "p.1 ↗"); assert.equal(result.second, "p.2 ↗");
  assert.equal(result.chipCount, 6);
  assert.equal(result.chipOnlyParagraphs, 0, JSON.stringify(result));
  assert.equal(result.inlineChip, true); assert.equal(result.listChip, true); assert.equal(result.tableChip, true); assert.equal(result.eofChip, true);
  const provenance = await page.evaluate(async () => {
    const lines = ["---", "nomad_transcripts: true", "---", "", "<!-- supernote-page:native%3Aa number:1 -->", "Repeated words.", "", "<!-- supernote-page:native%3Ab number:2 -->", "Repeated words.", "Continuation."];
    let canonical = lines.join("\n");
    const path = "Transcripts/book.md", file = { path, extension: "md", isTFile: true };
    const calls = [];
    const plugin = {
      app: { vault: { getAbstractFileByPath: () => file, cachedRead: async () => canonical }, workspace: { updateOptions(){}, getLeavesOfType(){return []} } },
      register(){}, registerEditorExtension(){}, registerMarkdownPostProcessor(){},
    };
    PageLinksBrowserBundle.installPageLinks(plugin, async () => {}, () => false, { resolveSelection: async (source, markers) => {
      calls.push({source, markers}); return { path: "/storage/emulated/0/Note/book.note", page: markers[0].number, pageId: markers[0].pageId, pageIds: markers.map(x => x.pageId) };
    } });
    async function render(from) {
      const element = document.createElement("div");
      const ok = await plugin.pageLinks.renderSection({ element, sourcePath: path, markdown: lines.slice(from).join("\n"), sourceLineMap: lines.slice(from).map((_, i) => from+i), component: {}, selectionProvenance: true });
      if (!ok) throw Error("Provenance rendering declined");
      return element;
    }
    const chapter = await render(8); // mid-page chapter, no explicit marker within it
    const moved = document.createElement("div"); moved.append(...chapter.childNodes); document.body.append(moved);
    const text = [...moved.querySelectorAll("p")][0].lastChild;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
    const mid = await plugin.pageLinks.selectionSource({ element: moved, sourcePath:path, range });
    const full = await render(4); document.body.append(full);
    const paragraphs = full.querySelectorAll("p");
    const spanning = document.createRange(); spanning.setStart(paragraphs[0].lastChild, 0); spanning.setEnd(paragraphs[1].lastChild, 8);
    const multi = await plugin.pageLinks.selectionSource({ element:full, sourcePath:path, range:spanning });
    const hidden = [...full.querySelectorAll(".st-digest-anchor")].every(node => node.hidden && node.getBoundingClientRect().width === 0);
    canonical += "\nEdited";
    let stale = false;
    try { await plugin.pageLinks.selectionSource({ element: moved, sourcePath:path, range }); } catch { stale=true; }
    canonical = "Ordinary Markdown";
    const ordinary = await plugin.pageLinks.selectionSource({ element: moved, sourcePath:path, range });
    return { mid, multi, hidden, chips:full.querySelectorAll("button.st-page-link").length, stale, ordinary, callCount:calls.length };
  });
  assert.deepEqual(provenance.mid.pageIds, ["native:b"]);
  assert.deepEqual(provenance.multi.pageIds, ["native:a", "native:b"]);
  assert.equal(provenance.hidden, true); assert.equal(provenance.chips, 0);
  assert.equal(provenance.stale, true); assert.equal(provenance.ordinary, null); assert.equal(provenance.callCount, 2);
});
