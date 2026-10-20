import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["src/structure-migration.ts"], bundle: true, platform: "node", format: "esm", write: false });
const migration = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
const identityBuilt = await build({ entryPoints: ["src/notebook-identity.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { notebookIdentityFor } = await import("data:text/javascript;base64," + Buffer.from(identityBuilt.outputFiles[0].text).toString("base64"));

function ioFixture(initial = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set();
  const addParents = (path) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  };
  for (const path of files.keys()) addParents(path);
  const direct = (set, path) => [...set].filter((entry) => entry.startsWith(`${path}/`) && !entry.slice(path.length + 1).includes("/"));
  const io = {
    exists: async (path) => files.has(path) || folders.has(path),
    list: async (path) => ({ files: direct(files.keys(), path), folders: direct(folders, path) }),
    read: async (path) => { if (!files.has(path)) throw Error(`missing ${path}`); return files.get(path); },
    mkdir: async (path) => { addParents(`${path}/_`); folders.add(path); },
    rename: async (from, to) => {
      if (files.has(from)) {
        if (files.has(to) || folders.has(to)) throw Error("destination exists");
        addParents(to); files.set(to, files.get(from)); files.delete(from); return;
      }
      if (!folders.has(from) || files.has(to) || folders.has(to)) throw Error("cannot rename folder");
      const oldFiles = [...files].filter(([path]) => path.startsWith(`${from}/`));
      const oldFolders = [...folders].filter((path) => path === from || path.startsWith(`${from}/`));
      for (const [path, value] of oldFiles) { files.delete(path); const moved = `${to}${path.slice(from.length)}`; addParents(moved); files.set(moved, value); }
      for (const path of oldFolders) folders.delete(path);
      for (const path of oldFolders) folders.add(`${to}${path.slice(from.length)}`);
      addParents(`${to}/_`); folders.add(to);
    },
    remove: async (path) => files.delete(path),
    rmdir: async (path) => {
      if (direct(files.keys(), path).length || direct(folders, path).length) throw Error("not empty");
      folders.delete(path);
    },
  };
  return { io, files, folders };
}
const cloneMap = (value) => Object.fromEntries([...value].sort(([a], [b]) => a.localeCompare(b)));
const noteA = "/storage/emulated/0/Note/Reflections/One.note";
const noteB = "/storage/emulated/0/Note/Reflections/Two.note";
function configAndStore() {
  const oldOne = { id: "old-rule-one", sharedId: "old-shared-one", enabled: true, source: noteA, output: "Old/One", recursive: false, exclude: [], profileId: "general" };
  const oldTwo = { id: "old-rule-two", sharedId: "old-shared-two", enabled: true, source: noteB, output: "Old/Two", recursive: false, exclude: [], profileId: "general" };
  const state = (source, ruleId, output, text) => ({
    id: `state-${ruleId}`, source, ruleId, output, status: "current", outputOverride: `Custom/${text}.md`,
    publishedHash: `${text}-published-hash`, publishedText: `${text}-published-text`,
    order: [`${text}-page`], desired: [{ id: `${text}-page`, number: 1 }],
    pages: { [`${text}-page`]: { text: `${text}-recognized`, fingerprint: `${text}-fingerprint` } },
    editedPages: { [`${text}-page`]: { text: `${text}-edited`, baseText: `${text}-base` } },
    publishedPages: [`${text}-page`],
  });
  const config = { version: 1, profiles: [{ id: "general", name: "General", model: "model", endpoint: "https://example.test/v1", prompt: "Transcribe", glossaries: [] }], rules: [oldOne, oldTwo] };
  const store = {
    version: 1,
    notebooks: {
      [noteA]: state(noteA, oldOne.id, oldOne.output, "one"),
      [noteB]: state(noteB, oldTwo.id, oldTwo.output, "two"),
    },
    queue: [{ source: noteA }, { source: noteB }],
    history: ["Supernote Transcripts/History/one.md", "Custom/keep.md"],
  };
  return { config, store, oldOne, oldTwo };
}

test("storage move planning preflights every legacy subtree before any mutation", async () => {
  const f = ioFixture({
    "Supernote Transcripts/Shared Data/ok.md": "same",
    "_supernote/Shared Data/ok.md": "different",
    "Supernote Transcripts/History/other.md": "untouched",
  });
  const beforeFiles = cloneMap(f.files), beforeFolders = [...f.folders].sort();
  await assert.rejects(migration.planStorageMoves(f.io), /Both .* exist with different contents/);
  assert.deepEqual(cloneMap(f.files), beforeFiles);
  assert.deepEqual([...f.folders].sort(), beforeFolders);
});

test("same-content destination duplicates are deduplicated during an otherwise successful move", async () => {
  const f = ioFixture({
    "Supernote Transcripts/History/duplicate.md": "identical",
    "_supernote/History/duplicate.md": "identical",
    "Supernote Transcripts/History/new.md": "new history",
  });
  const plan = await migration.planStorageMoves(f.io);
  assert.ok(plan.some((move) => move.duplicate && move.from.endsWith("duplicate.md")));
  await migration.executeStorageMoves(f.io, plan);
  assert.equal(f.files.get("_supernote/History/duplicate.md"), "identical");
  assert.equal(f.files.get("_supernote/History/new.md"), "new history");
  assert.equal(f.files.has("Supernote Transcripts/History/duplicate.md"), false);
});

test("interrupted storage moves can be safely replanned and resumed", async () => {
  const f = ioFixture({
    "Supernote Transcripts/History/a.md": "a",
    "Supernote Transcripts/History/b.md": "b",
  });
  const plan = await migration.planStorageMoves(f.io);
  const rename = f.io.rename;
  let count = 0;
  f.io.rename = async (from, to) => { await rename(from, to); if (++count === 1) throw Error("simulated interruption"); };
  await assert.rejects(migration.executeStorageMoves(f.io, plan), /simulated interruption/);
  f.io.rename = rename;
  const resumed = await migration.planStorageMoves(f.io);
  await migration.executeStorageMoves(f.io, resumed);
  assert.equal(f.files.get("_supernote/History/a.md"), "a");
  assert.equal(f.files.get("_supernote/History/b.md"), "b");
  assert.equal(f.files.has("Supernote Transcripts/History/a.md"), false);
  assert.equal(f.files.has("Supernote Transcripts/History/b.md"), false);
});

test("legacy Transcripts children move into the parent transcript root", async () => {
  const f = ioFixture({
    "Supernote Transcripts/Transcripts/Nested/One.md": "transcript",
    "Supernote Transcripts/Keep.md": "existing",
  });
  await migration.executeStorageMoves(f.io, await migration.planStorageMoves(f.io));
  assert.equal(f.files.get("Supernote Transcripts/Nested/One.md"), "transcript");
  assert.equal(f.files.get("Supernote Transcripts/Keep.md"), "existing");
  assert.equal(f.files.has("Supernote Transcripts/Transcripts/Nested/One.md"), false);
});

test("reference migration moves only paths and retains page, edit, publication and history data", () => {
  const { config, store } = configAndStore();
  config.profiles[0].glossaries = ["Supernote Transcripts/Glossaries/terms.txt", "Custom/terms.md"];
  config.rules[0].output = "Supernote Transcripts/Transcripts/One";
  config.rules[0].sharedBaseline = {
    profile: { id: "general", name: "General", model: "model", endpoint: "https://example.test/v1", prompt: "Transcribe", glossaries: ["Supernote Transcripts/Glossaries/baseline.txt"] },
    output: "Supernote Transcripts/Transcripts/Shared", recursive: true, exclude: [],
  };
  const originalNotebook = structuredClone(store.notebooks[noteA]);
  const result = migration.migrateStructureReferences(config, store);
  assert.equal(result.changed, true);
  assert.deepEqual(result.config.profiles[0].glossaries, ["_supernote/Glossaries/terms.txt", "Custom/terms.md"]);
  assert.equal(result.config.rules[0].output, "Supernote Transcripts/One");
  assert.deepEqual(result.config.rules[0].sharedBaseline, config.rules[0].sharedBaseline, "causal baseline must remain the exact previously agreed value");
  assert.equal(result.store.notebooks[noteA].output, originalNotebook.output);
  assert.deepEqual(result.store.notebooks[noteA].outputOverride, originalNotebook.outputOverride);
  for (const key of ["publishedHash", "publishedText", "order", "desired", "pages", "editedPages", "publishedPages"])
    assert.deepEqual(result.store.notebooks[noteA][key], originalNotebook[key], key);
  assert.deepEqual(result.store.history, ["_supernote/History/one.md", "Custom/keep.md"]);
  assert.equal(store.notebooks[noteA].publishedText, originalNotebook.publishedText);
  assert.equal(migration.migrateStructureReferences(result.config, result.store).changed, false);
});

test("consolidation retains per-notebook shared identities across changed rule and mirror IDs", async () => {
  const { config, store, oldOne, oldTwo } = configAndStore();
  oldTwo.enabled = false; // A paused/disabled old source still owns its cached identity.
  const identities = await Promise.all([
    notebookIdentityFor(oldOne, noteA), notebookIdentityFor(oldTwo, noteB),
  ]);
  const result = await migration.consolidateFolder(config, store, {
    source: "/storage/emulated/0/Note/Reflections", ruleId: "new-folder-rule", sharedId: "new-shared-mirror",
    profileId: "general", notebooks: [noteA, noteB], allowed: [noteA],
  });
  assert.equal(result.rule.output, "Supernote Transcripts/Reflections");
  assert.deepEqual(result.rule.notebookIds, { "One.note": identities[0], "Two.note": identities[1] });
  assert.equal(new Set(Object.values(result.rule.notebookIds)).size, 2);
  assert.deepEqual(result.config.rules.map((rule) => rule.id), ["new-folder-rule"]);
  assert.equal(result.store.notebooks[noteA].ruleId, "new-folder-rule");
  assert.equal(result.store.notebooks[noteB].ruleId, "new-folder-rule");
  assert.equal(result.store.notebooks[noteB].status, "excluded");
  assert.equal(result.store.notebooks[noteB].error, "Excluded from recognition. Existing transcript is retained.");
  assert.deepEqual(result.store.queue, [{ source: noteA }]);
  for (const key of ["publishedHash", "publishedText", "pages", "editedPages"])
    assert.deepEqual(result.store.notebooks[noteB][key], store.notebooks[noteB][key], key);
  assert.equal(store.notebooks[noteB].ruleId, oldTwo.id, "input store must remain unchanged");
});

test("consolidation validates folder, profile, notebook selection and output paths", async () => {
  const base = configAndStore();
  const options = { source: "/storage/emulated/0/Note/Reflections", ruleId: "new-rule", sharedId: "new-shared", profileId: "general", notebooks: [noteA], allowed: [noteA] };
  for (const change of [
    (o) => { o.source = noteA; },
    (o) => { o.profileId = "missing"; },
    (o) => { o.notebooks = []; o.allowed = []; },
    (o) => { o.notebooks = [noteA, noteA]; },
    (o) => { o.allowed = [noteB]; },
    (o) => { o.output = "../outside"; },
    (o) => { o.output = "_supernote/History"; },
  ]) {
    const changed = structuredClone(options); change(changed);
    await assert.rejects(migration.consolidateFolder(base.config, base.store, changed));
  }
  const nestedRuleConfig = structuredClone(base.config);
  nestedRuleConfig.rules.push({ id: "nested-folder", enabled: true, source: `${options.source}/Nested`, output: "Old/Nested", recursive: true, exclude: [], profileId: "general" });
  await assert.rejects(migration.consolidateFolder(nestedRuleConfig, base.store, options), /nested|overlap|child/i);
});


test("changing shared identity clears the former mirror's causal baseline", async () => {
  const {config,store}=configAndStore();
  const prior=config.rules[0];prior.sharedRevision="a".repeat(64);prior.sharedAncestors=["b".repeat(64)];prior.sharedBaseline={output:prior.output};
  const next=await migration.consolidateFolder(config,store,{source:"/storage/emulated/0/Note/Reflections",ruleId:prior.id,sharedId:"different-shared",profileId:"general",notebooks:[noteA,noteB],allowed:[noteA]});
  for(const key of ["sharedBaseline","sharedRevision","sharedAncestors"])assert.equal(next.rule[key],undefined,key);
  assert.equal(next.rule.notebookIds["One.note"],await notebookIdentityFor(prior,noteA));
});

test("transcript relocation refuses to orphan Reader highlight identities", async () => {
  const path="Reader Highlights/test.md";
  const record={version:1,source:"Supernote Transcripts/Transcripts/One.md"};
  const {io,files}=ioFixture({[path]:"<!-- md-reader-highlight:v1\n"+JSON.stringify(record)+"\n-->\n\n> Highlight"});
  const before=cloneMap(files);
  await assert.rejects(migration.assertReaderRelocationSafe(io),/Reader highlights/i);
  assert.deepEqual(cloneMap(files),before);
  files.set(path,"<!-- md-reader-highlight:v1\n"+JSON.stringify({...record,source:"Notes/One.md"})+"\n-->");
  await migration.assertReaderRelocationSafe(io);
});
