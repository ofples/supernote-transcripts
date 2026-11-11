import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const directory = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${directory}test-artifacts`, { recursive: true });
await build({ entryPoints: [`${directory}src/runtime.ts`], outfile: `${directory}test-artifacts/shared-preferences-runtime.mjs`, bundle: true,
  format: "esm", platform: "browser", external: ["fs", "http", "os"], loader: { ".txt": "text" }, plugins: [
    { name: "shared-preferences-runtime", setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: `${directory}tests/mock-obsidian.mjs` }));
      build.onResolve({ filter: /^\.\/reader$/ }, args => args.importer.endsWith("runtime.ts") ? ({ path: `${directory}tests/mock-reader.mjs` }) : undefined);
      build.onResolve({ filter: /^\.\/desktop-reader$/ }, () => ({ path: `${directory}tests/mock-reader.mjs` }));
      build.onResolve({ filter: /^\.\/ui$/ }, () => ({ path: `${directory}tests/mock-ui.mjs` }));
    } },
  ] });
const { default: Runtime } = await import("../test-artifacts/shared-preferences-runtime.mjs");

const shared = new Map();
const profile = (changes = {}) => ({ id: "general", name: "General", model: "model-a", endpoint: "https://api.example.test/v1/responses", prompt: "Transcribe", glossaries: [], quality: "balanced", ...changes });
const config = (profileChanges = {}) => ({ version: 1, profiles: [profile(profileChanges)], rules: [], intervalMinutes: 5, batchPages: 2,
  continuous: false, showPageHeadings: false });
function device(name, profileChanges = {}) {
  const adapter = {
    exists: async path => shared.has(path), read: async path => { if (!shared.has(path)) throw Error("missing"); return shared.get(path); },
    write: async (path, value) => shared.set(path, value),
    list: async path => ({ files: [...shared.keys()].filter(item => item.startsWith(path + "/") && shared.get(item) !== "folder"), folders: [] }),
  };
  const app = { vault: { configDir: `.${name}`, adapter, getName: () => name,
    createFolder: async path => shared.set(path, "folder"),
    create: async (path, value) => { if (shared.has(path)) throw Error("exists"); shared.set(path, value); } },
    workspace: { onLayoutReady() {} } };
  const plugin = new Runtime(app);
  plugin.config = config(profileChanges);
  plugin.initializing = false;
  return { plugin, app };
}
function localStore(values = {}) {
  const storage = new Map(Object.entries(values));
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  return storage;
}

test("first shared defaults require an explicit choice, then later defaults hydrate without changing local execution state", async () => {
  shared.clear();
  globalThis.__desktop = true;
  const desktop = device("desktop");
  await desktop.plugin.saveConfig();
  desktop.plugin.config.profiles[0].model = "model-b";
  desktop.plugin.config.cleanupPrompt = "Shared cleanup";
  desktop.plugin.config.showPageHeadings = true;
  await desktop.plugin.saveConfig();

  const storage = localStore({
    "nomad-transcripts:nomad:provider": "subscription",
    "nomad-transcripts:nomad:workers": "7",
    "nomad-transcripts:nomad:auto": "false",
    "nomad-transcripts:nomad:ai": "false",
    "nomad-transcripts:nomad:paused": "true",
  });
  const nomad = device("nomad");
  await nomad.plugin.refreshSharedSettings();
  assert.equal(nomad.plugin.config.profiles[0].model, "model-a");
  assert.equal(nomad.plugin.globalPreferencesIssue?.fields.includes("shared defaults"), true);
  await nomad.plugin.resolveSharedPreferences("remote");
  assert.equal(nomad.plugin.config.profiles[0].model, "model-b");
  assert.equal(nomad.plugin.config.cleanupPrompt, "Shared cleanup");
  assert.equal(nomad.plugin.config.showPageHeadings, true);
  assert.equal(nomad.plugin.progress.running, false);
  assert.equal(nomad.plugin.store.queue.length, 0);
  assert.equal(nomad.plugin.autoEnabled, false);
  assert.equal(nomad.plugin.aiEnabled, false);
  assert.equal(nomad.plugin.concurrency, 7);
  assert.equal(nomad.plugin.provider, "subscription");
  assert.equal(storage.get("nomad-transcripts:nomad:paused"), "true");

  desktop.plugin.config.profiles[0].model = "model-c";
  await desktop.plugin.saveConfig();
  await nomad.plugin.refreshSharedSettings();
  assert.equal(nomad.plugin.config.profiles[0].model, "model-c");
  assert.equal(nomad.plugin.progress.running, false);
  assert.equal(storage.get("nomad-transcripts:nomad:paused"), "true");
});

test("runtime reports divergent default edits without overwriting either device", async () => {
  shared.clear();
  globalThis.__desktop = true;
  localStore();
  const desktop = device("desktop-conflict");
  await desktop.plugin.saveConfig();
  const nomad = device("nomad-conflict");
  await nomad.plugin.refreshSharedSettings();

  desktop.plugin.config.profiles[0].prompt = "Desktop prompt";
  await desktop.plugin.saveConfig();
  nomad.plugin.config.profiles[0].prompt = "Nomad prompt";
  await nomad.plugin.saveConfig();

  assert.equal(nomad.plugin.globalPreferencesIssue?.fields.includes("profile.prompt"), true);
  assert.equal(nomad.plugin.config.profiles[0].prompt, "Nomad prompt");
  assert.equal(desktop.plugin.config.profiles[0].prompt, "Desktop prompt");
  await nomad.plugin.resolveSharedPreferences("remote");
  assert.equal(nomad.plugin.config.profiles[0].prompt, "Desktop prompt");
  assert.equal(nomad.plugin.globalPreferencesIssue, undefined);
});
