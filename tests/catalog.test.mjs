import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${directory}test-artifacts`, { recursive: true });
await build({ entryPoints: [`${directory}src/catalog.ts`], outfile: `${directory}test-artifacts/catalog-test.mjs`,
  bundle: true, format: "esm", platform: "browser" });
const { MirrorCatalog, CatalogConflictError, mirrorRevision, mirrorFingerprint } = await import("../test-artifacts/catalog-test.mjs");
const settings = ({ revision, ancestors, ...value }) => value;
function fixture() {
  const files = new Map(), folders = new Set();
  const io = {
    exists: async (path) => files.has(path) || folders.has(path),
    read: async (path) => { if (!files.has(path)) throw Error("missing"); return files.get(path); },
    write: async (path, value) => { files.set(path, value); },
    create: async (path, value) => { if (files.has(path)) throw Error("exists"); files.set(path, value); },
    mkdir: async (path) => { folders.add(path); },
    list: async (path) => ({ files: [...files.keys()].filter((p) => p.startsWith(path + "/")), folders: [] }),
  };
  return { files, io, catalog: new MirrorCatalog(io), make: () => new MirrorCatalog(io) };
}
const portable = () => ({
  profile: { id: "general", name: "General", model: "vision-model", endpoint: "https://example.test/v1/responses", quality: "balanced",
    prompt: "Transcribe this page faithfully.", glossaries: ["References/Glossary.md", "References/Terms.txt"] },
  output: "Supernote Transcripts/Transcripts", recursive: true, exclude: ["existing/a.note", "Private/**", "literal\\*.note"],
});
const parse = (body) => JSON.parse(body.split("```json\n")[1].split("\n```\n")[0]);
const envelope = (value) => "<!-- nomad-transcripts-mirror-v1 -->\n```json\n" + JSON.stringify(value) + "\n```\n";
test("catalog carries readable logical mirrors and portable glossary references to another device", async () => {
  const f = fixture();
  await f.catalog.save("rule-uuid", "Satsang", portable());
  const mirror = await f.make().load("rule-uuid");
  assert.deepEqual(settings(mirror), { id: "rule-uuid", name: "Satsang", ...portable() });
  assert.match([...f.files.keys()][0], /^Supernote Transcripts\/Shared Data\/Mirrors\/[a-f0-9]{64}\.md$/);
  assert.equal((await f.catalog.list()).length, 1);
});
test("catalog round-trips quality and keeps old records without quality readable as fast-compatible", async () => {
  const f = fixture();
  const profile = portable();
  profile.profile.quality = "careful";
  await f.catalog.save("careful", "Careful", profile);
  assert.equal((await f.make().load("careful")).profile.quality, "careful");
  const path = [...f.files.keys()][0], old = parse(f.files.get(path));
  delete old.profile.quality;
  delete old.revision; delete old.ancestors;
  f.files.set(path, envelope(old));
  assert.equal((await f.make().load("careful")).profile.quality, undefined);
});
test("only portable whitelist fields are written, never source mounts, credentials or execution settings", async () => {
  const f = fixture(), input = portable();
  input.source = "C:/Private/Notes";
  input.paused = true;
  input.apiKey = "private-key";
  input.aiEnabled = true;
  input.profile.apiKey = "another-secret";
  input.profile.source = "/storage/emulated/0/Note/Private";
  await f.catalog.save("rule", "Shared mirror", input);
  const body = [...f.files.values()][0];
  for (const forbidden of ["private-key", "another-secret", "C:/Private", "/storage/emulated", "paused", "aiEnabled", "apiKey"])
    assert.equal(body.includes(forbidden), false);
  assert.deepEqual((await f.catalog.load("rule")).profile, portable().profile);
});
test("an explicit shared mirror edit replaces its valid definition", async () => {
  const f = fixture();
  await f.catalog.save("rule", "Old", portable());
  const updated = portable();
  updated.profile.prompt = "New explicit instructions";
  updated.exclude.push("Other/**");
  await f.catalog.save("rule", "Renamed", updated);
  assert.deepEqual(settings(await f.make().load("rule")), { id: "rule", name: "Renamed", ...updated });
  assert.equal(f.files.size, 1);
});
test("catalog rejects native paths, traversal, nonportable references and secret-bearing endpoints", async () => {
  const modifications = [
    (r) => { r.output = "C:/OtherVault"; },
    (r) => { r.output = "/storage/emulated/0/Note"; },
    (r) => { r.output = "../Outside"; },
    (r) => { r.profile.glossaries = ["C:/Private/Terms.md"]; },
    (r) => { r.profile.glossaries = [".obsidian/key.md"]; },
    (r) => { r.profile.glossaries = ["References/private.json"]; },
    (r) => { r.exclude = ["/storage/emulated/0/Note/a.note"]; },
    (r) => { r.exclude = ["C:\\Notes\\a.note"]; },
    (r) => { r.exclude = ["Folder/../a.note"]; },
    (r) => { r.exclude = ["\\\\server\\notes"]; },
    (r) => { r.profile.endpoint = "https://key:password@example.test/v1"; },
    (r) => { r.profile.endpoint = "https://example.test/v1?api_key=secret"; },
    (r) => { r.profile.endpoint = "https://example.test/v1#secret"; },
    (r) => { r.profile.endpoint = "file:///private/key"; },
    (r) => { r.profile.quality = "unlimited"; },
  ];
  for (const change of modifications) {
    const f = fixture(), input = portable();
    change(input);
    await assert.rejects(f.catalog.save("rule", "Mirror", input));
    assert.equal(f.files.size, 0);
  }
  const f = fixture();
  for (const id of ["../id", "id space", "", "id/part", "id.note"])
    await assert.rejects(f.catalog.save(id, "Mirror", portable()));
});
test("malformed or unreadable catalog records are omitted and preserved", async () => {
  const f = fixture();
  await f.catalog.save("rule", "Mirror", portable());
  const path = [...f.files.keys()][0];
  f.files.set(path, "manual corruption");
  assert.deepEqual(await f.catalog.list(), []);
  assert.equal(f.catalog.problems.length, 1);
  await assert.rejects(f.catalog.save("rule", "Mirror", portable()), CatalogConflictError);
  assert.equal(f.files.get(path), "manual corruption");
  f.io.read = async () => { throw Error("unreadable"); };
  assert.deepEqual(await f.catalog.list(), []);
});
test("wrong identity and malformed references in synced records are rejected", async () => {
  const f = fixture();
  await f.catalog.save("rule", "Mirror", portable());
  const path = [...f.files.keys()][0], original = parse(f.files.get(path));
  f.files.set(path, envelope({ ...original, id: "other-rule" }));
  assert.deepEqual(await f.catalog.list(), []);
  f.files.set(path, envelope({ ...original, profile: { ...original.profile, glossaries: ["../private.md"] } }));
  assert.deepEqual(await f.catalog.list(), []);
});
test("identical Sync conflict copies are harmless, conflicting definitions are unavailable for import", async () => {
  const f = fixture();
  await f.catalog.save("rule", "Mirror", portable());
  const path = [...f.files.keys()][0], body = f.files.get(path), copy = path.replace(".md", " (conflict).md");
  f.files.set(copy, body);
  assert.equal((await f.catalog.list()).length, 1);
  const conflicting = parse(body);
  conflicting.profile.prompt = "A different paid recipe";
  conflicting.revision = await mirrorRevision(conflicting);
  f.files.set(copy, envelope(conflicting));
  assert.deepEqual(await f.catalog.list(), []);
  assert.match(f.catalog.problems[0].reason, /Conflicting/);
  await assert.rejects(f.catalog.save("rule", "Mirror", portable()), CatalogConflictError);
  assert.equal(f.files.get(path), body);
  f.files.set(copy, "broken conflict copy");
  assert.deepEqual(await f.catalog.list(), []);
});
test("catalog list ordering is stable and a damaged mirror does not block unrelated mirrors", async () => {
  const f = fixture();
  await f.catalog.save("z", "Zulu", portable());
  const damagedPath = [...f.files.keys()][0];
  f.files.set(damagedPath, "damaged");
  await f.catalog.save("b", "Beta", portable());
  await f.catalog.save("a", "Alpha", portable());
  assert.deepEqual((await f.catalog.list()).map((m) => m.name), ["Alpha", "Beta"]);
  assert.equal(await f.catalog.load("missing"), undefined);
});

test("expected snapshot prevents stale concurrent writes across catalog instances", async () => {
  const { mirrorFingerprint } = await import("../test-artifacts/catalog-test.mjs");
  const f = fixture();
  await f.catalog.save("rule", "Mirror", portable(), null);
  const snapshot = mirrorFingerprint(await f.catalog.load("rule"));
  const first = portable(), second = portable();
  first.profile.prompt = "First edit"; second.profile.prompt = "Second edit";
  const results = await Promise.allSettled([
    f.catalog.save("rule", "Mirror", first, snapshot), f.make().save("rule", "Mirror", second, snapshot),
  ]);
  assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected");
  assert.ok(results[1].reason instanceof CatalogConflictError);
  assert.equal((await f.catalog.load("rule")).profile.prompt, "First edit");
  await assert.rejects(f.catalog.save("rule", "Mirror", second, null), CatalogConflictError);
});
test("no-op preserves records; editing with identical Sync copies requires resolution", async () => {
  const f = fixture();
  await f.catalog.save("rule", "Mirror", portable());
  const path = [...f.files.keys()][0], body = f.files.get(path);
  f.files.set(path.replace(".md", " (conflict).md"), body);
  let writes = 0; f.io.write = async () => { writes++; };
  await f.catalog.save("rule", "Mirror", portable()); assert.equal(writes, 0);
  const update = portable(); update.output = "Other";
  await assert.rejects(f.catalog.save("rule", "Mirror", update), CatalogConflictError);
});

test("causal revision history distinguishes offline siblings from descendants and stale ancestors",async()=>{
  const a=fixture(), b=fixture();
  const initial=await a.catalog.save("rule","Mirror",portable());
  assert.match(initial.revision,/^[a-f0-9]{64}$/);assert.deepEqual(initial.ancestors,[]);
  for(const [path,body]of a.files)b.files.set(path,body);
  await b.io.mkdir(a.catalog.folder);
  const ours=portable(),theirs=portable();ours.profile.prompt="Offline B";theirs.profile.prompt="Offline C";
  const branchB=await a.catalog.save("rule","Mirror",ours,mirrorFingerprint(initial));
  const branchC=await b.catalog.save("rule","Mirror",theirs,mirrorFingerprint(initial));
  assert.notEqual(branchB.revision,branchC.revision);
  assert.ok(branchB.ancestors.includes(initial.revision));assert.ok(branchC.ancestors.includes(initial.revision));
  assert.equal(branchC.ancestors.includes(branchB.revision),false);
  const next=portable();next.profile.prompt="Descendant D";
  const descendant=await a.catalog.save("rule","Mirror",next,mirrorFingerprint(branchB));
  assert.ok(descendant.ancestors.includes(branchB.revision));assert.ok(descendant.ancestors.includes(initial.revision));
  assert.deepEqual(await a.catalog.save("rule","Mirror",next),descendant);
});

test("legacy records remain readable and upgrade with their content revision as ancestor",async()=>{
  const f=fixture();await f.catalog.save("rule","Mirror",portable());
  const path=[...f.files.keys()][0],legacy=parse(f.files.get(path));
  delete legacy.revision;delete legacy.ancestors;f.files.set(path,envelope(legacy));
  const before=await f.catalog.load("rule");assert.equal(before.revision,undefined);
  const updated=portable();updated.profile.prompt="Edited after upgrade";
  const saved=await f.catalog.save("rule","Mirror",updated,mirrorFingerprint(before));
  assert.deepEqual(saved.ancestors,[await mirrorRevision(before)]);
});

test("malformed or tampered lineage blocks import and overwrite",async()=>{
  for(const damage of [
    r=>{r.profile.prompt="Tampered without new hash";},
    r=>{r.revision="not a hash";},
    r=>{delete r.ancestors;},
    r=>{r.ancestors=[r.revision];},
    r=>{r.ancestors=["a".repeat(64),"a".repeat(64)];},
    r=>{r.ancestors=["C:/Private/path"];},
  ]){
    const f=fixture();await f.catalog.save("rule","Mirror",portable());
    const path=[...f.files.keys()][0],record=parse(f.files.get(path));damage(record);f.files.set(path,envelope(record));
    assert.deepEqual(await f.catalog.list(),[]);assert.equal(f.catalog.problems.length,1);
    await assert.rejects(f.catalog.save("rule","Mirror",portable()),CatalogConflictError);
  }
});

test("lineage is bounded and supplied input cannot smuggle ancestry or credentials",async()=>{
  const f=fixture();let previous;
  for(let n=0;n<259;n++){
    const value=portable();value.profile.prompt=`Revision ${n}`;value.ancestors=["secret"];value.revision="secret";
    previous=await f.catalog.save("rule","Mirror",value);
  }
  assert.equal(previous.ancestors.length,256);
  assert.equal(previous.ancestors.includes(previous.revision),false);
  assert.equal([...f.files.values()].some(body=>body.includes("secret")),false);
});
