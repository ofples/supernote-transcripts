import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

class FakeElement {
  constructor(className = "") {
    this.className = className;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.removed = false;
    this.parentElement = null;
    this.classList = { add: value => { this.className = `${this.className} ${value}`.trim(); } };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  remove() {
    this.removed = true;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
  insertAdjacentElement(position, element) {
    if (position !== "afterend" || !this.parentElement) return null;
    const siblings = this.parentElement.children;
    const existing = siblings.indexOf(element);
    if (existing >= 0) siblings.splice(existing, 1);
    const index = siblings.indexOf(this);
    siblings.splice(index + 1, 0, element);
    element.parentElement = this.parentElement;
    return element;
  }
  querySelector(selector) {
    for (const child of this.children) {
      const matches = selector === ".sn-mode-action" ? child.className.split(/\s+/).includes("sn-mode-action")
        : selector === '.view-action[aria-label^="Current view:"]' && child.className.split(/\s+/).includes("view-action") &&
          child.getAttribute("aria-label")?.startsWith("Current view:");
      if (matches) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeButton extends FakeElement {
  constructor(className = "view-action") { super(className); }
}

globalThis.HTMLButtonElement = FakeButton;
globalThis.document = { createElement: tag => tag === "button" ? new FakeButton() : new FakeElement() };

const mocks = {
  obsidian: `
    export const editorInfoField = {};
    export const editorLivePreviewField = {};
    export const MarkdownRenderer = { async render() {} };
    export class MarkdownRenderChild {}
    export class MarkdownView {}
    export class Notice { constructor(message) { globalThis.notices.push(message); } }
    export class TFile { static [Symbol.hasInstance](value) { return value?.isTFile === true; } }
  `,
  "@codemirror/view": `
    export class Decoration { static replace(value) { return value; } static widget(value) { return value; } }
    export class WidgetType {}
    export class EditorView { static decorations = { from() {} }; }
    export class ViewPlugin { static fromClass(value) { return value; } }
  `,
  "@codemirror/state": `
    export class RangeSetBuilder { add() {} finish() { return []; } }
    export class StateEffect { static define() { return { of(value) { return { value }; }, is() { return false; } }; } }
    export class StateField { static define(value) { return value; } }
  `,
};
const bundled = await build({
  entryPoints: ["src/page-links-ui.ts"], bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "test-mocks", setup(buildApi) {
    buildApi.onResolve({ filter: /^(obsidian|@codemirror\/view|@codemirror\/state)$/ }, args => ({ path: args.path, namespace: "test-mock" }));
    buildApi.onLoad({ filter: /.*/, namespace: "test-mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }],
});
const { installPageLinks } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

const linkedSource = ["---", "nomad_transcripts: true", "---", "", "# Notebook", "<!-- supernote-page:native%3Apage number:1 -->"].join("\n");
const ordinarySource = ["---", "nomad_transcripts: true", "---", "", "No page links."].join("\n");
const makeFile = (path, mtime = 1) => ({ path, extension: "md", stat: { mtime }, isTFile: true });

function setup() {
  const linkedFile = makeFile("Transcripts/linked.md");
  const ordinaryFile = makeFile("Transcripts/ordinary.md");
  const files = new Map([[linkedFile.path, linkedFile], [ordinaryFile.path, ordinaryFile]]);
  const contents = new Map([[linkedFile.path, linkedSource], [ordinaryFile.path, ordinarySource]]);
  const viewLeaves = new Map();
  const workspaceHandlers = new Map();
  const vaultHandlers = new Map();
  const cleanup = [];
  const storage = new Map();
  const storageKey = "device:page-links-files";
  globalThis.notices = [];
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  const allViews = () => Array.from(viewLeaves.values()).flat();
  let optionUpdates = 0;
  let readerRefreshes = 0;
  const workspace = {
    updateOptions() { optionUpdates++; },
    getLeavesOfType(type) { return viewLeaves.get(type) ?? []; },
    iterateAllLeaves(callback) { for (const leaf of allViews()) callback(leaf); },
    on(name, callback) { workspaceHandlers.set(name, callback); return { name, callback }; },
  };
  const vault = {
    getAbstractFileByPath(path) { return files.get(path) ?? null; },
    async cachedRead(file) { return contents.get(file.path) ?? ""; },
    on(name, callback) { vaultHandlers.set(name, callback); return { name, callback }; },
  };
  const plugin = {
    app: { vault, workspace, plugins: { plugins: { "md-reader": { refreshTranscriptLinks() { readerRefreshes++; } } } } },
    register(callback) { cleanup.push(callback); },
    registerEvent() {},
    registerEditorExtension() {},
    registerMarkdownPostProcessor() {},
  };
  return {
    plugin, linkedFile, ordinaryFile, files, contents, viewLeaves, workspaceHandlers, vaultHandlers,
    storage, storageKey, cleanup, optionUpdates: () => optionUpdates, readerRefreshes: () => readerRefreshes,
  };
}

function makeView(type, file, source, header = new FakeElement("view-header")) {
  const actions = [];
  const view = {
    file,
    headerEl: header,
    getViewType: () => type,
    editor: source === undefined ? undefined : { getValue: () => source.value },
    addAction(icon, title, callback) {
      const button = new FakeButton();
      button.icon = icon;
      button.actionTitle = title;
      button.callback = callback;
      header.appendChild(button);
      actions.push(button);
      return button;
    },
    previewMode: { rerender() {} },
  };
  return { view, header, actions };
}

test("header actions are scoped to linked documents and placed beside core and Sidebar mode controls", async () => {
  const ctx = setup();
  const linkedSource = { value: linkedSourceText() };
  const coreMode = new FakeButton("view-action");
  coreMode.setAttribute("aria-label", "Current view: Reading view");
  const coreHeader = new FakeElement("view-header");
  coreHeader.appendChild(coreMode);
  const core = makeView("markdown", ctx.linkedFile, linkedSource, coreHeader);
  const ordinary = makeView("markdown", ctx.ordinaryFile, { value: ordinarySource });
  const paperMode = new FakeButton("sn-mode-action");
  const paperHeader = new FakeElement("view-header");
  paperHeader.appendChild(paperMode);
  const paper = makeView("paper-sidebar", ctx.linkedFile, undefined, paperHeader);
  ctx.viewLeaves.set("markdown", [{ view: core.view }, { view: ordinary.view }]);
  ctx.viewLeaves.set("paper-sidebar", [{ view: paper.view }]);

  const plugin = { ...ctx.plugin, app: ctx.plugin.app, register: callback => ctx.cleanup.push(callback) };
  installPageLinks(plugin, async () => {}, () => false, { storageKey: ctx.storageKey });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(core.actions.length, 1);
  assert.equal(core.actions[0].hidden, false);
  assert.equal(coreMode.parentElement.children.indexOf(core.actions[0]), coreHeader.children.indexOf(coreMode) + 1);
  assert.equal(ordinary.actions.length, 1);
  assert.equal(ordinary.actions[0].hidden, true);
  assert.equal(paper.actions.length, 1);
  assert.equal(paper.actions[0].hidden, false);
  assert.equal(paperMode.parentElement.children.indexOf(paper.actions[0]), paperHeader.children.indexOf(paperMode) + 1);

  core.actions[0].callback({});
  assert.equal(plugin.pageLinks.enabled("Transcripts/linked.md"), true);
  assert.equal(plugin.pageLinks.enabled("Transcripts/ordinary.md"), false);
  assert.equal(JSON.parse(ctx.storage.get(ctx.storageKey)).overrides["Transcripts/linked.md"], true);
  assert.equal(core.actions[0].getAttribute("aria-pressed"), "true");
  assert.ok(ctx.optionUpdates() > 0);
  assert.ok(ctx.readerRefreshes() > 1);

  for (const dispose of ctx.cleanup) dispose();
  assert.equal(core.actions[0].removed, true);
  assert.equal(paper.actions[0].removed, true);
});

test("file switches reject stale clicks, modified reader files rescan, and closed views release actions", async () => {
  const ctx = setup();
  const source = { value: linkedSourceText() };
  const core = makeView("markdown", ctx.linkedFile, source);
  const reader = makeView("horizontal-reader-view", ctx.linkedFile, undefined);
  ctx.viewLeaves.set("markdown", [{ view: core.view }]);
  ctx.viewLeaves.set("horizontal-reader-view", [{ view: reader.view }]);
  const plugin = { ...ctx.plugin, app: ctx.plugin.app, register: callback => ctx.cleanup.push(callback) };
  installPageLinks(plugin, async () => {}, () => false, { storageKey: ctx.storageKey });
  await new Promise(resolve => setImmediate(resolve));
  const [coreButton] = core.actions;
  const [readerButton] = reader.actions;
  assert.equal(coreButton.hidden, false);
  assert.equal(readerButton.hidden, false);
  coreButton.callback({});
  assert.equal(plugin.pageLinks.enabled("Transcripts/linked.md"), true);

  core.view.file = ctx.ordinaryFile;
  source.value = ordinarySource;
  coreButton.callback({}); // The old visible button cannot toggle the previous document.
  assert.equal(JSON.parse(ctx.storage.get(ctx.storageKey)).overrides["Transcripts/linked.md"], true);
  assert.equal(plugin.pageLinks.enabled("Transcripts/ordinary.md"), false);
  ctx.workspaceHandlers.get("editor-change")();
  assert.equal(coreButton.hidden, true);

  ctx.contents.set(ctx.linkedFile.path, ordinarySource);
  ctx.linkedFile.stat.mtime++;
  ctx.vaultHandlers.get("modify")(ctx.linkedFile);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readerButton.hidden, true);

  ctx.viewLeaves.set("horizontal-reader-view", []);
  ctx.workspaceHandlers.get("layout-change")();
  assert.equal(readerButton.removed, true);
  for (const dispose of ctx.cleanup) dispose();
  assert.equal(coreButton.removed, true);
});

function linkedSourceText() { return linkedSource; }
