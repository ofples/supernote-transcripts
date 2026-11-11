import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/document-source.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { DocumentSources } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function adapter(id, extension, entries = []) {
  const calls = [];
  const reader = {
    async list(path, recursive, exclude) {
      calls.push(["list", path, recursive, exclude]);
      return entries;
    },
    async revision(path) { calls.push(["revision", path]); return `${id}:revision`; },
    async open(path, options) {
      calls.push(["open", path, options]);
      return { descriptor: { path, revision: "r1", pages: [], width: 1, height: 1 },
        async render(page) { calls.push(["render", page]); return `${id}:${page}`; },
        close() { calls.push(["close"]); } };
    },
  };
  return { id, matches: path => path.toLowerCase().endsWith(extension), reader, calls };
}

test("document formats dispatch file operations to their unique owner", async () => {
  const note = adapter("supernote", ".note");
  const fixture = adapter("fixture", ".fixture");
  const sources = new DocumentSources([note, fixture]);
  assert.equal(sources.documentFormat("/vault/a.note"), "supernote");
  assert.equal(sources.documentFormat("/vault/a.fixture"), "fixture");
  assert.equal(sources.documentFormat("/vault/folder"), undefined);
  assert.equal(sources.supportsDocument("/vault/a.fixture"), true);
  assert.equal(await sources.revision("/vault/a.fixture"), "fixture:revision");
  const opened = await sources.open("/vault/a.fixture", { mode: "all" });
  assert.equal(opened.descriptor.path, "/vault/a.fixture");
  assert.deepEqual(fixture.calls.map(call => call[0]), ["revision", "open"]);
  assert.deepEqual(note.calls, []);
});

test("folder listing keeps only owned entries, deduplicates, and sorts by path", async () => {
  const note = adapter("supernote", ".note", [
    { path: "/vault/z.note", size: 2, mtime: 1 },
    { path: "/vault/shared.fixture", size: 999, mtime: 999 },
    { path: "/vault/a.note", size: 1, mtime: 1 },
    { path: "/vault/a.note", size: 1, mtime: 1 },
  ]);
  const fixture = adapter("fixture", ".fixture", [
    { path: "/vault/shared.fixture", size: 3, mtime: 2 },
    { path: "/vault/b.fixture", size: 4, mtime: 1 },
  ]);
  const sources = new DocumentSources([note, fixture]);
  const entries = await sources.list("/vault", true, ["hidden"]);
  assert.deepEqual(entries.map(entry => entry.path), [
    "/vault/a.note", "/vault/b.fixture", "/vault/shared.fixture", "/vault/z.note",
  ]);
  assert.equal(entries.find(entry => entry.path.endsWith("shared.fixture")).size, 3);
  assert.deepEqual(note.calls[0], ["list", "/vault", true, ["hidden"]]);
  assert.deepEqual(fixture.calls[0], ["list", "/vault", true, ["hidden"]]);
});

test("ambiguous file ownership and unsupported file operations fail explicitly", async () => {
  const one = adapter("one", ".fixture");
  const two = adapter("two", ".fixture");
  const sources = new DocumentSources([one, two]);
  assert.throws(() => sources.documentFormat("x.fixture"), /More than one document format/);
  assert.throws(() => sources.open("x.unsupported"), /No registered document format/);
});

test("preview uses adapter preview or closes an opened document after rendering", async () => {
  const fallback = adapter("fallback", ".fixture");
  const sources = new DocumentSources([fallback]);
  assert.equal(await sources.preview("x.fixture", 4), "fallback:4");
  assert.deepEqual(fallback.calls.map(call => call[0]), ["open", "render", "close"]);

  const direct = adapter("direct", ".note");
  direct.reader.preview = async (path, page) => `${path}:${page}`;
  const withDirect = new DocumentSources([direct]);
  assert.equal(await withDirect.preview("x.note", 2), "x.note:2");
  assert.deepEqual(direct.calls, []);
});
