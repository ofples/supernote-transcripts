import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/support-file-exclusions.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const exclusions = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

test("support path matching is case-insensitive and respects the directory boundary", () => {
  for (const path of ["_supernote", "_supernote/Shared Data/result.md", "_SUPERNOTE\\History\\entry.md", "\\_supernote\\Archive"])
    assert.equal(exclusions.isSupportFilePath(path), true, path);
  for (const path of ["_supernote-old/item.md", "Notes/_supernote/item.md", "Supernote Transcripts/2610 - Reflection.md", "_supernoteish/item.md", null])
    assert.equal(exclusions.isSupportFilePath(path), false, String(path));
});

test("Quick Switcher filtering removes only existing files inside the support root", () => {
  const visible = { type: "file", file: { path: "Notes/Reflection.md" } };
  const alias = { type: "alias", file: { path: "_supernote/Glossaries/Sanskrit.md" }, alias: "Sanskrit" };
  const fuzzyMatch = { item: { type: "file", file: { path: "_supernote/Shared Data/result.md" } }, match: {} };
  const unresolved = { type: "unresolved", path: "_supernote/new-file" };
  const filtered = exclusions.filterSupportFileSuggestions([visible, alias, fuzzyMatch, unresolved]);
  assert.deepEqual(filtered, [visible, unresolved]);
});

function makeSwitcher({ suggestions, promise = false } = {}) {
  class NativeModal {
    constructor() {
      this.closed = false;
    }
    getSuggestions() { return promise ? Promise.resolve(suggestions) : suggestions; }
    onClose() { this.closed = true; }
    open() { return this.getSuggestions(); }
  }
  const boundOpen = function () {
    this.activeModal = new NativeModal(this.app, {});
    return this.activeModal.open();
  };
  const instance = {
    QuickSwitcherModal: NativeModal,
    onOpen: boundOpen.bind(null),
    app: {},
  };
  // Core registers callbacks already bound to the original onOpen implementation.
  instance.onOpen = boundOpen.bind(instance);
  const callbacks = [];
  const plugin = {
    app: { internalPlugins: { getPluginById: (id) => id === "switcher" ? { instance } : undefined } },
    register: (callback) => callbacks.push(callback),
  };
  return { instance, plugin, callbacks };
}

for (const promise of [false, true]) {
  test(`installer filters bound native modal suggestions (${promise ? "Promise" : "sync"})`, async () => {
    const allowed = { type: "file", file: { path: "Notes/Keep.md" } };
    const hidden = { type: "file", file: { path: "_supernote/Transcripts/old.md" } };
    const fixture = makeSwitcher({ suggestions: [allowed, hidden], promise });
    const NativeModal = fixture.instance.QuickSwitcherModal;
    const beforeDescriptor = Object.getOwnPropertyDescriptor(NativeModal.prototype, "getSuggestions");
    const cleanup = exclusions.installSupportFileExclusions(fixture.plugin);
    assert.equal(typeof cleanup, "function");
    assert.equal(fixture.callbacks.length, 1);

    const result = fixture.instance.onOpen();
    assert.deepEqual(await result, [allowed]);
    const modal = fixture.instance.activeModal;
    assert.deepEqual(await modal.getSuggestions(), [allowed]);
    cleanup();
    assert.deepEqual(Object.getOwnPropertyDescriptor(NativeModal.prototype, "getSuggestions"), beforeDescriptor);
    assert.deepEqual(await modal.getSuggestions(), [allowed, hidden]);
  });
}

test("unregister restores the exact prototype descriptor and preserves third-party replacements", () => {
  const fixture = makeSwitcher({ suggestions: [] });
  const prototype = fixture.instance.QuickSwitcherModal.prototype;
  const before = Object.getOwnPropertyDescriptor(prototype, "getSuggestions");
  const cleanup = exclusions.installSupportFileExclusions(fixture.plugin);
  cleanup();
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "getSuggestions"), before);

  const cleanupAgain = exclusions.installSupportFileExclusions(fixture.plugin);
  const thirdParty = function thirdParty() { return []; };
  Object.defineProperty(prototype, "getSuggestions", { configurable: true, writable: true, value: thirdParty });
  cleanupAgain();
  assert.equal(prototype.getSuggestions, thirdParty);
});

test("unsupported switcher instances are left untouched", () => {
  const instance = { onOpen() {} };
  let registered = false;
  const plugin = {
    app: { internalPlugins: { getPluginById: () => ({ instance }) } },
    register: () => { registered = true; },
  };
  assert.equal(exclusions.installSupportFileExclusions(plugin), undefined);
  assert.equal(registered, false);
});

test("installer reads current root preferences for each request and hides the reserved locator", async () => {
  const oldRoot = { type: "file", file: { path: "_supernote/old.md" } };
  const customRoot = { type: "file", file: { path: "Private Support/item.md" } };
  const locator = { type: "file", file: { path: "_supernote-storage.md" } };
  const note = { type: "file", file: { path: "Notes/keep.md" } };
  const fixture = makeSwitcher({ suggestions: [oldRoot, customRoot, locator, note] });
  let prefs = { root: "Private Support", exclude: true }, reads = 0;
  const cleanup = exclusions.installSupportFileExclusions(fixture.plugin, () => { reads++; return prefs; });
  assert.deepEqual(fixture.instance.onOpen(), [oldRoot, note]);
  prefs = { root: "Private Support", exclude: false };
  assert.deepEqual(fixture.instance.onOpen(), [oldRoot, customRoot, note]);
  assert.equal(reads, 2);
  cleanup();
});
