import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({ entryPoints: ["src/digest-preferences.ts"], outfile: "test-artifacts/digest-preferences-test.mjs", bundle: true, format: "esm", platform: "browser" });
const { validateDigestCategoryName, digestPreferencesForOutput } = await import("../test-artifacts/digest-preferences-test.mjs");

const fixture = () => ({
  config: { rules: [{ id: "source", enabled: true, source: "/Note/Satsang", output: "Transcripts/Satsang" }] },
  store: { notebooks: { "/Note/Satsang/One.note": { ruleId: "source", source: "/Note/Satsang/One.note", output: "Transcripts/Satsang/One.md" } } },
});
test("Digest categories preserve inheritance, explicit Uncategorized and native names", () => {
  assert.equal(validateDigestCategoryName(undefined), undefined);
  assert.equal(validateDigestCategoryName(""), "");
  assert.equal(validateDigestCategoryName("  Study notes  "), "Study notes");
  assert.equal(validateDigestCategoryName("संस्कृत"), "संस्कृत");
  for (const value of [null, 4, {}, "x".repeat(129), "wrong\nname", "bad\u007f"])
    assert.throws(() => validateDigestCategoryName(value), /Digest category/);
});
test("source Digest preferences bind only an owned transcript, including paused sources", () => {
  const { config, store } = fixture();
  assert.equal(digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), null);
  config.rules[0].digestCategoryName = "Satsang";
  assert.deepEqual(digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), { categoryName: "Satsang" });
  config.rules[0].enabled = false;
  assert.deepEqual(digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), { categoryName: "Satsang" });
  assert.equal(digestPreferencesForOutput(config, store, "Transcripts/Satsang/Personal.md"), null);
  config.rules[0].digestCategoryName = "";
  assert.deepEqual(digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), { categoryName: "" });
});
test("explicit output relocations retain category ownership without claiming the old file", () => {
  const { config, store } = fixture(); config.rules[0].digestCategoryName = "Study";
  store.notebooks["/Note/Satsang/One.note"].outputOverride = "Reading/One.md";
  assert.deepEqual(digestPreferencesForOutput(config, store, "Reading/One.md"), { categoryName: "Study" });
  assert.equal(digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), null);
});
test("ambiguous and damaged ownership fails rather than choosing the wrong category", () => {
  const { config, store } = fixture();
  store.notebooks.other = { ...store.notebooks["/Note/Satsang/One.note"], source: "/Note/Other.note" };
  assert.throws(() => digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), /More than one/);
  delete store.notebooks.other; config.rules = [];
  assert.throws(() => digestPreferencesForOutput(config, store, "Transcripts/Satsang/One.md"), /source settings/);
});
