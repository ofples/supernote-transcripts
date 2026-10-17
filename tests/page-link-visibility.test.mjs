import test from "node:test";
import assert from "node:assert/strict";
import { createPageLinkVisibility } from "../src/page-link-visibility.mjs";

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("per-file visibility overrides the legacy global default and survives recreation", () => {
  const storage = makeStorage();
  let globalEnabled = true;
  const create = () => createPageLinkVisibility(storage, "device:page-links-files", () => globalEnabled);
  let visibility = create();

  assert.equal(visibility.enabled(), true);
  assert.equal(visibility.enabled("Transcripts/one.md"), true);
  assert.equal(visibility.setEnabled("Transcripts/one.md", false), true);
  assert.equal(visibility.enabled("Transcripts/one.md"), false);
  assert.equal(visibility.enabled("Transcripts/two.md"), true);
  assert.equal(visibility.hasOverride("Transcripts/one.md"), true);

  globalEnabled = false;
  assert.equal(visibility.enabled("Transcripts/two.md"), false);
  assert.equal(visibility.enabled(), false);
  visibility.setEnabled("Transcripts/two.md", true);
  assert.equal(visibility.enabled(), true); // Legacy no-argument reader precheck sees an explicit visible file.

  visibility = create();
  assert.equal(visibility.enabled("Transcripts/one.md"), false);
  assert.equal(visibility.enabled("Transcripts/two.md"), true);
});

test("rename, delete, and clearing remove stale per-file overrides", () => {
  const storage = makeStorage();
  const visibility = createPageLinkVisibility(storage, "device:page-links-files", () => true);
  visibility.setEnabled("Old/book.md", false);
  assert.equal(visibility.rename("Old/book.md", "New/book.md"), true);
  assert.equal(visibility.hasOverride("Old/book.md"), false);
  assert.equal(visibility.enabled("New/book.md"), false);
  assert.equal(visibility.deletePath("New/book.md"), true);
  assert.equal(visibility.hasOverride("New/book.md"), false);
  visibility.setEnabled("One/book.md", true);
  visibility.setEnabled("Two/book.md", false);
  visibility.clearAll();
  assert.equal(storage.getItem("device:page-links-files"), null);
});

test("invalid paths and malformed stored data cannot create overrides", () => {
  const storage = makeStorage({ "device:page-links-files": JSON.stringify({ version: 1, overrides: {
    "../secret.md": true,
    "Transcripts/good.md": false,
    "Transcripts/bad.md": "false",
  } }) });
  const visibility = createPageLinkVisibility(storage, "device:page-links-files", () => true);
  assert.equal(visibility.enabled("Transcripts/good.md"), false);
  assert.equal(visibility.hasOverride("../secret.md"), false);
  assert.equal(visibility.enabled("Transcripts/bad.md"), true);
  assert.equal(visibility.setEnabled("../secret.md", false), false);
  assert.equal(visibility.setEnabled("Transcripts/good.md", "false"), false);
});

test("storage failures fall back to the global setting without throwing", () => {
  const brokenStorage = {
    getItem() { throw new Error("storage unavailable"); },
    setItem() { throw new Error("storage unavailable"); },
    removeItem() { throw new Error("storage unavailable"); },
  };
  const visibility = createPageLinkVisibility(brokenStorage, "device:page-links-files", () => false);
  assert.equal(visibility.enabled("Transcripts/book.md"), false);
  assert.equal(visibility.setEnabled("Transcripts/book.md", true), false);
  assert.equal(visibility.enabled("Transcripts/book.md"), true); // The in-session choice still works even when storage is unavailable.
  assert.equal(visibility.enabled(), true);
});
