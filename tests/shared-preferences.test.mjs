import test from "node:test";
import assert from "node:assert/strict";
import { SharedPreferencesStore, portablePreferences, reconcilePreferences } from "../src/shared-preferences.mjs";

const defaults = () => ({
  profile: { model: "model-a", endpoint: "https://api.example.test/v1/responses", prompt: "Transcribe", glossaries: ["Glossaries/Terms.md"], quality: "balanced", preserveFormatting: true },
  cleanupPrompt: "Clean carefully", showPageHeadings: false,
});
function sharedFiles(files = new Map()) {
  return {
    files,
    io: {
      exists: async path => files.has(path),
      read: async path => { if (!files.has(path)) throw Error("missing"); return files.get(path); },
      write: async (path, value) => files.set(path, value),
      create: async (path, value) => { if (files.has(path)) throw Error("exists"); files.set(path, value); },
      list: async folder => ({ files: [...files.keys()].filter(path => path.startsWith(folder + "/")), folders: [] }),
      mkdir: async path => files.set(path, "folder"),
    },
  };
}

test("portable global preferences whitelist strips identity, credentials, and device settings", () => {
  const value = defaults();
  value.profile.id = "local-profile"; value.profile.name = "Private label";
  value.profile.endpoint = "https://api.example.test/v1/responses";
  value.profile.apiKey = "never-share";
  value.provider = "subscription"; value.autoEnabled = true; value.concurrency = 9; value.pause = true;
  const portable = portablePreferences(value);
  assert.deepEqual(Object.keys(portable).sort(), ["cleanupPrompt", "profile", "showPageHeadings"]);
  assert.deepEqual(Object.keys(portable.profile).sort(), ["endpoint", "glossaries", "model", "preserveFormatting", "prompt", "quality"]);
  assert.equal(JSON.stringify(portable).includes("never-share"), false);
  assert.equal(JSON.stringify(portable).includes("subscription"), false);
});

test("two device stores exchange defaults and merge independent changes through shared Markdown", async () => {
  const { io, files } = sharedFiles();
  const desktop = new SharedPreferencesStore(io, "_supernote/Shared Data");
  const nomad = new SharedPreferencesStore(io, "_supernote/Shared Data");
  const first = await desktop.save(defaults(), null);
  assert.ok(files.has("_supernote/Shared Data/Preferences/global-preferences.md"));
  const received = await nomad.load();
  assert.deepEqual(received.preferences, defaults());

  const baseline = received.preferences;
  const local = defaults(); local.cleanupPrompt = "Local cleanup";
  const remote = defaults(); remote.profile.model = "model-b";
  await desktop.save(remote, first.revision);
  const merge = reconcilePreferences(local, baseline, (await nomad.load()).preferences);
  assert.deepEqual(merge.conflicts, []);
  assert.equal(merge.value.profile.model, "model-b");
  assert.equal(merge.value.cleanupPrompt, "Local cleanup");
  assert.equal(merge.publish, true);
  const converged = await nomad.save(merge.value, (await nomad.load()).revision);
  assert.deepEqual((await desktop.load()).preferences, merge.value);
  assert.ok(converged.revision);
});

test("divergent edits keep both original local values and baseline until explicit choice", () => {
  const baseline = defaults(), local = defaults(), remote = defaults();
  local.profile.prompt = "Local prompt"; remote.profile.prompt = "Remote prompt";
  remote.showPageHeadings = true;
  const result = reconcilePreferences(local, baseline, remote);
  assert.deepEqual(result.conflicts, ["profile.prompt"]);
  assert.equal(result.value.profile.prompt, "Local prompt");
  assert.equal(result.value.showPageHeadings, false);
  assert.equal(result.baseline.profile.prompt, baseline.profile.prompt);
});

test("endpoint credentials and query parameters are rejected, not synchronized", () => {
  for (const endpoint of ["https://user:pass@example.test/v1", "https://example.test/v1?key=secret", "http://example.test/v1#fragment"])
    assert.throws(() => portablePreferences({ ...defaults(), profile: { ...defaults().profile, endpoint } }), /credentials, queries or fragments/);
});

test("Sync conflict copies and stale writes block publication", async () => {
  const { io, files } = sharedFiles();
  const store = new SharedPreferencesStore(io, "_supernote/Shared Data");
  const saved = await store.save(defaults(), null);
  const path = "_supernote/Shared Data/Preferences/global-preferences.md";
  files.set("_supernote/Shared Data/Preferences/global-preferences (conflict copy).md", files.get(path));
  await assert.rejects(store.load(), /Sync conflict copy/);
  files.delete("_supernote/Shared Data/Preferences/global-preferences (conflict copy).md");
  await assert.rejects(store.save(defaults(), "0".repeat(64)), /changed while saving/);
  assert.equal((await store.load()).revision, saved.revision);
});
