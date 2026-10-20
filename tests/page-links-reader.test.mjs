import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

class FakeNode {
  constructor() { this.children = []; this.childNodes = this.children; this.dataset = {}; this.attributes = {}; this.listeners = {}; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; this.childNodes = this.children; for (const node of nodes) node.parentNode = this; }
  querySelectorAll(selector) { return selector === "a[href]" ? this.children.filter(node => node.tagName === "A") : []; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  replaceWith(node) {
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1, node);
    node.parentNode = this.parentNode;
  }
}

class FakeButton extends FakeNode {
  constructor() { super(); this.tagName = "BUTTON"; this.classList = { add() {} }; }
}
class FakeAnchor extends FakeNode {
  constructor(href) { super(); this.tagName = "A"; this.attributes.href = href; }
}
globalThis.document = { createElement(tag) { return tag === "button" ? new FakeButton() : new FakeNode(); } };
globalThis.HTMLButtonElement = FakeButton;
globalThis.FakeAnchor = FakeAnchor;

const mocks = {
  obsidian: `
    export const editorInfoField = {};
    export const editorLivePreviewField = {};
    export const MarkdownRenderer = { async render(_app, markdown, target) {
      if (globalThis.renderGate) { globalThis.renderGate.started(); await globalThis.renderGate.promise; }
      const pattern = /\\[[^\\]]+\\]\\((obsidian:\\/\\/[^)\\s]+)\\)/g;
      for (const match of markdown.matchAll(pattern)) target.appendChild(new globalThis.FakeAnchor(match[1]));
    } };
    export class MarkdownRenderChild {}
    export class MarkdownView {}
    export class Notice {}
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

const source = [
  "---", "nomad_transcripts: true", "---", "",
  "# Repeat", "<!-- supernote-page:native%3Afirst number:1 -->", "", "Repeated chapter text.", "",
  "# Repeat", "<!-- supernote-page:native%3Asecond number:2 -->", "", "Repeated chapter text.",
].join("\n");
const files = new Map([["Transcripts/book.md", { path: "Transcripts/book.md", extension: "md", isTFile: true }]]);
let enabled = true;
const cleanups = [];
const plugin = {
  app: {
    vault: {
      getAbstractFileByPath(path) { return files.get(path) ?? null; },
      async cachedRead(file) { return file.path === "Transcripts/book.md" ? source : ""; },
    },
    workspace: { updateOptions() {}, getLeavesOfType() { return []; } },
  },
  register() {},
  registerEditorExtension() {},
  registerMarkdownPostProcessor() {},
};

test("reader chapters validate page ids against their exact canonical source lines", async () => {
  installPageLinks(plugin, async () => {}, () => enabled);
  const firstElement = new FakeNode();
  const secondElement = new FakeNode();
  const firstMarkdown = "# Repeat\n<!-- supernote-page:native%3Afirst number:1 -->\n\nRepeated chapter text.";
  const secondMarkdown = "# Repeat\n<!-- supernote-page:native%3Asecond number:2 -->\n\nRepeated chapter text.";
  assert.equal(await plugin.pageLinks.renderSection({
    element: firstElement, sourcePath: "Transcripts/book.md", markdown: firstMarkdown,
    sourceLineMap: [4, 5, 6, 7], component: {},
  }), true);
  assert.equal(await plugin.pageLinks.renderSection({
    element: secondElement, sourcePath: "Transcripts/book.md", markdown: secondMarkdown,
    sourceLineMap: [9, 10, 11, 12], component: {},
  }), true);
  assert.deepEqual(firstElement.children.map(button => button.textContent), ["p.1 ↗"]);
  assert.deepEqual(secondElement.children.map(button => button.textContent), ["p.2 ↗"]);
  await plugin.pageLinks.renderSection({
    element: firstElement, sourcePath: "Transcripts/book.md", markdown: firstMarkdown,
    sourceLineMap: [4, 5, 6, 7], component: {},
  });
  assert.deepEqual(firstElement.children.map(button => button.textContent), ["p.1 ↗"]);
});

test("reader hook rejects spoofed markers and respects the page-link toggle", async () => {
  const target = new FakeNode();
  const markdown = "# Repeat\n<!-- supernote-page:native%3Asecond number:2 -->\n\nRepeated chapter text.";
  assert.equal(await plugin.pageLinks.renderSection({
    element: target, sourcePath: "Transcripts/book.md", markdown,
    sourceLineMap: [4, 5, 6, 7], component: {},
  }), false);
  assert.equal(target.children.length, 0);
  enabled = false;
  let readCount = 0;
  const cachedRead = plugin.app.vault.cachedRead;
  plugin.app.vault.cachedRead = async file => { readCount++; return cachedRead(file); };
  assert.equal(await plugin.pageLinks.renderSection({
    element: target, sourcePath: "Transcripts/book.md", markdown: "# Repeat\n<!-- supernote-page:native%3Afirst number:1 -->\n\nRepeated chapter text.",
    sourceLineMap: [4, 5, 6, 7], component: {},
  }), false);
  assert.equal(readCount, 0);
  enabled = true;
});

test("reader rendering rechecks the document toggle after its asynchronous render", async () => {
  const target = new FakeNode();
  let allowRender;
  let started;
  const renderStarted = new Promise(resolve => { started = resolve; });
  const renderGate = new Promise(resolve => { allowRender = resolve; });
  globalThis.renderGate = { promise: renderGate, started: () => started() };
  enabled = true;
  const result = plugin.pageLinks.renderSection({
    element: target, sourcePath: "Transcripts/book.md",
    markdown: "# Repeat\n<!-- supernote-page:native%3Afirst number:1 -->\n\nRepeated chapter text.",
    sourceLineMap: [4, 5, 6, 7], component: {},
  });
  await renderStarted;
  enabled = false;
  allowRender();
  assert.equal(await result, false);
  assert.equal(target.children.length, 0);
  delete globalThis.renderGate;
  enabled = true;
});

test("selection provenance cannot assign an inserted-only or out-of-file chapter to the last page", async () => {
  enabled = false;
  for (const sourceLineMap of [[null], [9999]]) {
    assert.equal(await plugin.pageLinks.renderSection({ element: new FakeNode(), sourcePath: "Transcripts/book.md",
      markdown: "Inserted text", sourceLineMap, component: {}, selectionProvenance: true }), false);
  }
  enabled = true;
});

test("view header toggle appears only for a document with page links and refreshes its state", () => {
  const actions = [];
  const toggleSource = { value: source };
  const view = {
    file: { path: "Transcripts/book.md" },
    editor: { getValue: () => toggleSource.value },
    getViewType: () => "markdown",
    addAction(icon, title, callback) {
      const button = new FakeButton();
      actions.push({ icon, title, callback, button });
      return button;
    },
    previewMode: { rerender() {} },
  };
  const workspace = {
    ...plugin.app.workspace,
    getLeavesOfType(type) { return type === "markdown" ? [{ view }] : []; },
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  const localPlugin = { ...plugin, app: { ...plugin.app, workspace }, register() {} };
  const controller = installPageLinks(localPlugin, async () => {}, () => true, { storageKey: "test-page-link-visibility" });
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.icon, "link-2");
  assert.equal(action.button.hidden, false);
  assert.equal(action.button.getAttribute("aria-label"), "Hide notebook page links");
  assert.equal(action.button.getAttribute("aria-pressed"), "true");
  action.callback({});
  assert.equal(action.button.getAttribute("aria-label"), "Show notebook page links");
  assert.equal(action.button.getAttribute("aria-pressed"), "false");

  toggleSource.value = "---\nnomad_transcripts: true\n---\n\nNo page links here.";
  controller.refresh();
  assert.equal(action.button.hidden, true);
  delete globalThis.localStorage;
});

test("optional horizontal reader view gets a per-document header toggle", async () => {
  const actions = [];
  const view = {
    file: files.get("Transcripts/book.md"),
    getViewType: () => "horizontal-reader-view",
    addAction(icon, title, callback) {
      const button = new FakeButton();
      actions.push({ icon, title, callback, button });
      return button;
    },
  };
  const workspace = {
    ...plugin.app.workspace,
    getLeavesOfType(type) { return type === "horizontal-reader-view" ? [{ view }] : []; },
  };
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const localPlugin = { ...plugin, app: { ...plugin.app, workspace }, register() {} };
  installPageLinks(localPlugin, async () => {}, () => true, { storageKey: "reader-page-link-visibility" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].button.hidden, false);
  assert.equal(actions[0].button.getAttribute("aria-label"), "Hide notebook page links");
  actions[0].callback({});
  assert.equal(actions[0].button.getAttribute("aria-pressed"), "false");
  delete globalThis.localStorage;
});

test("reader chips open the validated stable page and plugin unload removes the API", async () => {
  const opened = [];
  const localPlugin = {
    ...plugin,
    app: plugin.app,
    register(callback) { cleanups.push(callback); },
  };
  installPageLinks(localPlugin, async (...args) => { opened.push(args); }, () => enabled);
  const target = new FakeNode();
  await localPlugin.pageLinks.renderSection({
    element: target, sourcePath: "Transcripts/book.md",
    markdown: "# Repeat\n<!-- supernote-page:native%3Afirst number:1 -->\n\nRepeated chapter text.",
    sourceLineMap: [4, 5, 6, 7], component: {},
  });
  target.children[0].listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [["Transcripts/book.md", "native:first", 1]]);
  cleanups.forEach(cleanup => cleanup());
  assert.equal(localPlugin.pageLinks, undefined);
});

test("pageLinks publishes a versioned, capability-described contract", () => {
  installPageLinks(plugin, async () => {}, () => enabled);
  assert.equal(plugin.pageLinks.apiVersion, 1);
  assert.deepEqual(plugin.pageLinks.capabilities, ["renderSection", "selectionProvenance"]);
  assert.equal(typeof plugin.pageLinks.enabled, "function");
  assert.equal(typeof plugin.pageLinks.renderSection, "function");
  assert.equal(typeof plugin.pageLinks.selectionSource, "function");
});

test("page-link refresh works without a reader or with an upstream reader lacking the optional hook", () => {
  const originalPlugins = plugin.app.plugins;
  plugin.app.plugins = undefined;
  assert.doesNotThrow(() => installPageLinks(plugin, async () => {}, () => enabled).refresh());
  plugin.app.plugins = { plugins: { "md-reader": {} } };
  assert.doesNotThrow(() => installPageLinks(plugin, async () => {}, () => enabled).refresh());
  plugin.app.plugins = originalPlugins;
});

test("page-link refresh tolerates an incompatible hook and a throwing optional reader notification", () => {
  const originalPlugins = plugin.app.plugins;
  plugin.app.plugins = { plugins: { "md-reader": { refreshTranscriptLinks: "unsupported-api" } } };
  assert.doesNotThrow(() => installPageLinks(plugin, async () => {}, () => enabled).refresh());
  let refreshed = 0;
  plugin.app.plugins = { plugins: { "md-reader": { refreshTranscriptLinks() { refreshed++; } } } };
  installPageLinks(plugin, async () => {}, () => enabled).refresh();
  assert.equal(refreshed, 2); // Provider install and explicit refresh each notify once.
  plugin.app.plugins = { plugins: { "md-reader": { refreshTranscriptLinks() { throw new Error("reader failure"); } } } };
  assert.doesNotThrow(() => installPageLinks(plugin, async () => {}, () => enabled).refresh());
  plugin.app.plugins = originalPlugins;
});

test("late provider install and unload notify a loaded reader after API state changes", () => {
  const originalPlugins = plugin.app.plugins;
  const observations = [];
  const localPlugin = {
    ...plugin,
    app: { ...plugin.app, plugins: { plugins: { "md-reader": { refreshTranscriptLinks() {
      observations.push(localPlugin.pageLinks !== undefined);
    } } } } },
    register(callback) { cleanups.push(callback); },
  };
  const controller = installPageLinks(localPlugin, async () => {}, () => enabled);
  assert.deepEqual(observations, [true]);
  assert.ok(localPlugin.pageLinks);

  // A newer provider may replace this one before unload; stale cleanup must
  // preserve it and must not emit a false unavailable transition.
  const newerProvider = { apiVersion: 1, capabilities: ["renderSection"] };
  localPlugin.pageLinks = newerProvider;
  const cleanup = cleanups.pop();
  cleanup();
  assert.equal(localPlugin.pageLinks, newerProvider);
  assert.deepEqual(observations, [true]);

  const secondPlugin = {
    ...plugin,
    app: { ...localPlugin.app, plugins: { plugins: { "md-reader": { refreshTranscriptLinks() {
      observations.push(secondPlugin.pageLinks !== undefined);
    } } } } },
    register(callback) { this.cleanup = callback; },
  };
  installPageLinks(secondPlugin, async () => {}, () => enabled);
  assert.equal(observations.at(-1), true);
  secondPlugin.cleanup();
  assert.equal(secondPlugin.pageLinks, undefined);
  assert.equal(observations.at(-1), false);
  plugin.app.plugins = originalPlugins;
});

test("page-link refresh invalidates open MD Reader chapters through its optional hook", () => {
  let refreshed = 0;
  plugin.app.plugins = { plugins: { "md-reader": { refreshTranscriptLinks() { refreshed++; } } } };
  const controller = installPageLinks(plugin, async () => {}, () => enabled);
  controller.refresh();
  assert.equal(refreshed, 2);
  delete plugin.app.plugins;
});

test("reader refresh observes page-link disable and re-enable transitions", () => {
  const originalPlugins = plugin.app.plugins;
  const observedEnabled = [];
  let linksEnabled = true;
  plugin.app.plugins = { plugins: { "md-reader": { refreshTranscriptLinks() {
    observedEnabled.push(plugin.pageLinks?.enabled() ?? false);
  } } } };
  const controller = installPageLinks(plugin, async () => {}, () => linksEnabled);
  linksEnabled = false;
  controller.refresh();
  linksEnabled = true;
  controller.refresh();
  assert.deepEqual(observedEnabled, [true, false, true]);
  plugin.app.plugins = originalPlugins;
});

test("async reader refresh rejection is contained", async () => {
  const originalPlugins = plugin.app.plugins;
  let unhandled;
  const recordUnhandled = error => { unhandled = error; };
  process.on("unhandledRejection", recordUnhandled);
  plugin.app.plugins = { plugins: { "md-reader": { refreshTranscriptLinks() { return Promise.reject(new Error("async reader failure")); } } } };
  installPageLinks(plugin, async () => {}, () => enabled).refresh();
  await new Promise(resolve => setImmediate(resolve));
  process.off("unhandledRejection", recordUnhandled);
  assert.equal(unhandled, undefined);
  plugin.app.plugins = originalPlugins;
});

test("optional Reader Digest preferences remain independent of page-chip visibility", async () => {
  const resolver = async path => path === "Transcript.md" ? { categoryName: "Study" } : null;
  installPageLinks(plugin, async () => {}, () => false, { resolveDigestPreferences: resolver });
  assert.equal(plugin.pageLinks.apiVersion, 1);
  assert.equal(plugin.pageLinks.capabilities.includes("digestPreferences"), true);
  assert.deepEqual(await plugin.pageLinks.digestPreferences("Transcript.md"), { categoryName: "Study" });
  assert.equal(await plugin.pageLinks.digestPreferences("Other.md"), null);
  installPageLinks(plugin, async () => {}, () => true);
  assert.equal(plugin.pageLinks.capabilities.includes("digestPreferences"), false);
  assert.equal(plugin.pageLinks.digestPreferences, undefined);
});
