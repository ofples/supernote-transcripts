import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/page-navigation.ts"], bundle: true, platform: "node", format: "esm", write: false,
});
const load = (file) => import("data:text/javascript;base64," + Buffer.from(file.text).toString("base64"));
const { resolveNotePage, notePageUrl, isManagedTranscript } = await load(bundle.outputFiles[0]);

const source = "/storage/emulated/0/Note/Research/notes +%# one.note";
const output = "Transcripts/notes +%# one.md";
const rule = { id: "rule", enabled: true, source: "/storage/emulated/0/Note/Research", output: "Transcripts", recursive: true, exclude: [], profileId: "p" };
const config = { version: 1, profiles: [], rules: [rule], intervalMinutes: 0, batchPages: 1 };
function fixture({ outputPath = output, descriptors, revision = "r1", nextRevision = revision, sourcePath = source, extraState = {}, sharedIO, readText = "---\nnomad_transcripts: true\n---\n" } = {}) {
  const state = { id: "n", source: sourcePath, ruleId: "rule", output: outputPath, revision, order: [], desired: [], pages: {}, status: "current", ...extraState };
  const store = { version: 1, notebooks: { n: state }, queue: [], history: [] };
  const opened = { descriptor: { path: sourcePath, revision, pages: descriptors ?? [], width: 1404, height: 1872 }, closeCount: 0, close() { this.closeCount++; }, render() { throw Error("render must not be called"); } };
  const calls = { read: [], open: [], revision: [], writes: 0 };
  const reader = {
    async open(path) { calls.open.push(path); return opened; },
    async revision(path) { calls.revision.push(path); return nextRevision; },
    async list() { throw Error("list must not be called"); },
  };
  const options = { config, store, reader, async readTranscript(path) { calls.read.push(path); return readText; }, sharedIO };
  return { options, opened, calls, store };
}

test("managed transcript header is required and bounded", () => {
  assert.equal(isManagedTranscript("---\nnomad_transcripts: true\n---\nbody"), true);
  assert.equal(isManagedTranscript("---\nnomad_transcripts: false\n---\n"), false);
  assert.equal(isManagedTranscript("---\n" + "x".repeat(8193) + "\nnomad_transcripts: true\n---\n"), false);
  assert.equal(isManagedTranscript("body\n---\nnomad_transcripts: true\n---\n"), false);
});

test("stable page id follows current ordinal after insert and reorder", async () => {
  const f = fixture({ descriptors: [
    { id: "native:new", number: 1, fingerprint: "new" },
    { id: "native:target", number: 2, fingerprint: "target" },
    { id: "native:other", number: 3, fingerprint: "other" },
  ] });
  const result = await resolveNotePage({ outputPath: output, pageId: "native:target", displayNumber: 1 }, f.options);
  assert.deepEqual(result, { path: source, page: 2, pageId: "native:target" });
  assert.equal(f.opened.closeCount, 1);
  assert.deepEqual(f.calls.read, [output]);
});

test("desktop mode validates an absolute local notebook source", async () => {
  const desktopSource = "C:/Users/reader/Vault/Research/notes.note";
  const f = fixture({ sourcePath: desktopSource, descriptors: [
    { id: "native:target", number: 3, fingerprint: "target" },
  ] });
  f.options.platform = "desktop";
  const result = await resolveNotePage({ outputPath: output, pageId: "native:target", displayNumber: 3 }, f.options);
  assert.deepEqual(result, { path: desktopSource, page: 3, pageId: "native:target" });
  assert.deepEqual(f.calls.open, [desktopSource]);
});

test("removed ids, duplicate ids, and duplicate content identities fail closed", async () => {
  for (const descriptors of [
    [{ id: "native:other", number: 1, fingerprint: "x" }],
    [{ id: "native:target", number: 1, fingerprint: "x" }, { id: "native:target", number: 2, fingerprint: "y" }],
    [{ id: "content:same", number: 1, fingerprint: "same" }, { id: "native:other", number: 2, fingerprint: "same" }],
  ]) {
    const f = fixture({ descriptors });
    await assert.rejects(resolveNotePage({ outputPath: output, pageId: descriptors[0].id === "native:other" ? "native:target" : descriptors[0].id, displayNumber: 1 }, f.options));
    assert.equal(f.opened.closeCount, 1);
  }
});

test("revision change rejects target and always closes the notebook", async () => {
  const f = fixture({ descriptors: [{ id: "native:target", number: 4, fingerprint: "x" }], nextRevision: "r2" });
  await assert.rejects(resolveNotePage({ outputPath: output, pageId: "native:target", displayNumber: 1 }, f.options), /changed while locating/);
  assert.equal(f.opened.closeCount, 1);
});

test("invalid request, unmanaged transcript, and non-Nomad path fail before opening", async () => {
  for (const request of [
    { outputPath: "../unsafe.md", pageId: "native:x", displayNumber: 1 },
    { outputPath: output, pageId: "native:x", displayNumber: 0 },
    { outputPath: output, pageId: "", displayNumber: 1 },
  ]) {
    const f = fixture();
    await assert.rejects(resolveNotePage(request, f.options));
    assert.equal(f.calls.read.length, 0);
    assert.equal(f.calls.open.length, 0);
  }
  const unmanaged = fixture({ readText: "---\nother: true\n---\n" });
  await assert.rejects(resolveNotePage({ outputPath: output, pageId: "native:x", displayNumber: 1 }, unmanaged.options), /generated Supernote transcripts/);
  assert.equal(unmanaged.calls.open.length, 0);
  const invalidSource = fixture({ sourcePath: "/storage/emulated/0/Document/outside.note" });
  await assert.rejects(resolveNotePage({ outputPath: output, pageId: "native:x", displayNumber: 1 }, invalidSource.options));
  assert.equal(invalidSource.calls.open.length, 0);
});

test("failed routing does not mutate queue, cost state, or publication IO", async () => {
  const f = fixture({ descriptors: [], extraState: { publishedHash: "old" } });
  f.options.store.queue.push({ source, force: false });
  const before = JSON.stringify(f.options.store);
  let writes = 0;
  const sharedIO = { async exists() { return false; }, async read() { throw Error("unexpected read"); }, async write() { throw Error("unexpected write"); }, async create() { throw Error("unexpected create"); }, async list() { throw Error("unexpected list"); }, async mkdir() { throw Error("unexpected mkdir"); } };
  for (const method of ["write", "create", "mkdir"]) sharedIO[method] = async () => { writes++; throw Error("unexpected publication mutation"); };
  f.options.sharedIO = sharedIO;
  await assert.rejects(resolveNotePage({ outputPath: output, pageId: "native:missing", displayNumber: 1 }, f.options));
  assert.equal(JSON.stringify(f.options.store), before);
  assert.equal(writes, 0);
});

test("exact shared publication receipt binds an alternate Markdown output path", async () => {
  const sharedFiles = new Map();
  const sharedIO = {
    async exists(path) { return sharedFiles.has(path) || [...sharedFiles.keys()].some(k => k.startsWith(path + "/")); },
    async read(path) { if (!sharedFiles.has(path)) throw Error("missing"); return sharedFiles.get(path); },
    async write(path, text) { sharedFiles.set(path, text); },
    async create(path, text) { if (sharedFiles.has(path)) throw Error("exists"); sharedFiles.set(path, text); },
    async list(path) { const prefix = path + "/"; return { files: [...sharedFiles.keys()].filter(k => k.startsWith(prefix)), folders: [] }; },
    async mkdir() {},
  };
  const alternateOutput = "Desktop Mirror/notes +%# one.md";
  const descriptors = [{ id: "native:target", number: 7, fingerprint: "f-target" }];
  const f = fixture({ outputPath: "Transcripts/notes +%# one.md", descriptors, sharedIO });
  const { PublicationReceipts } = await load((await build({ entryPoints: ["src/publication.ts"], bundle: true, platform: "node", format: "esm", write: false })).outputFiles[0]);
  const { notebookIdentity } = await load((await build({ entryPoints: ["src/shared.ts"], bundle: true, platform: "node", format: "esm", write: false })).outputFiles[0]);
  const id = await notebookIdentity("logical-shared-id", "notes +%# one.note");
  const receipt = new PublicationReceipts(sharedIO);
  // Save against the exact Markdown bytes and page inventory, as a desktop publisher would.
  const transcript = "---\nnomad_transcripts: true\n---\nshared publication";
  await receipt.save(id, transcript, descriptors, {});
  f.options.store.notebooks.n.output = "some-other.md";
  f.options.store.notebooks.n.source = source;
  f.options.config.rules[0].sharedId = "logical-shared-id";
  f.options.readTranscript = async (path) => path === alternateOutput ? transcript : "";
  f.options.store.notebooks.n.output = "local-not-in-this-transcript.md";
  f.options.config.rules[0].output = "Transcripts";
  // The state source relative to rule must identify the exact receipt notebook.
  const result = await resolveNotePage({ outputPath: alternateOutput, pageId: "native:target", displayNumber: 99 }, f.options);
  assert.deepEqual(result, { path: source, page: 7, pageId: "native:target" });
});

test("page URL encodes the exact native file path and round-trips URI reserved characters", () => {
  const url = notePageUrl({ path: source, page: 12, pageId: "native:x" });
  const query = url.slice(url.indexOf("?") + 1);
  const params = new URLSearchParams(query);
  assert.equal(params.get("file"), source);
  assert.equal(params.get("page"), "12");
  assert.match(url, /%20/); assert.match(url, /%2B/); assert.match(url, /%25/); assert.match(url, /%23/);
  assert.throws(() => notePageUrl({ path: "/storage/emulated/0/Document/x.note", page: 1, pageId: "x" }));
});
