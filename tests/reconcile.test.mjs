import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSource,
  validateDestination,
  ruleFor,
  mirrorPath,
  reconcilePages,
  pendingPages,
  pageIdentity,
  recognizeRename,
  buildMarkdown,
  excludedRelative,
  orderedTasks,
  literalExclusion,
} from "../src/reconcile.mjs";
test("literal notebook exclusions escape wildcard filenames",()=>{
 const pattern=literalExclusion('old?*.note');assert.equal(excludedRelative('old?*.note',[pattern]),true);assert.equal(excludedRelative('older.note',[pattern]),false);
 assert.equal(excludedRelative('old?*.note',['old\\?*.note']),true);
});
test("exact exclusions and globs match paths safely without interpreting regex", () => {
  for (const [path, pattern, result] of [
    ["25 - old.note", "25*.note", true],
    ["Sub/25 - old.note", "25*.note", false],
    ["Sub/25 - old.note", "**/25*.note", true],
    ["25 - old.note", "**/25*.note", true],
    ["Archive/Old/a.note", "Archive", true],
    ["Archives/a.note", "Archive", false],
    ["2025/a.note", "20*", true],
    ["a.note", "?.note", true],
    ["aa.note", "?.note", false],
    ["(old)[1].note", "(old)[1].note", true],
    ["xold1.note", "(old)[1].note", false],
  ])
    assert.equal(
      excludedRelative(path, [pattern]),
      result,
      `${path}: ${pattern}`,
    );
});
test("manual queue priorities win over modification dates without mutating stored queue", () => {
  const tasks = [
    { source: "new", modified: 10 },
    { source: "old", modified: 1, priority: 1 },
    { source: "latest-choice", modified: 0, priority: 2 },
  ];
  assert.deepEqual(
    orderedTasks(tasks).map((t) => t.source),
    ["latest-choice", "old", "new"],
  );
  assert.equal(tasks[0].source, "new");
});
const saved = (fingerprint, text) => ({
  fingerprint,
  text,
  recipe: "r",
  number: 1,
});
test("insert, reorder and delete preserve page identity, while edits require recognition", () => {
  const old = {
    a: saved("A", "alpha"),
    b: saved("B", "beta"),
    c: saved("C", "gamma"),
  };
  const desired = [
    { id: "b", fingerprint: "B", number: 1 },
    { id: "new", fingerprint: "N", number: 2 },
    { id: "a", fingerprint: "A2", number: 3 },
  ];
  const next = { ...reconcilePages(old, desired), desired };
  assert.deepEqual(next.order, ["b", "new", "a"]);
  assert.equal(next.pages.b.text, "beta");
  assert.equal(next.pages.a.text, "alpha");
  assert.equal(next.pages.c, undefined);
  assert.deepEqual(
    pendingPages(next).map((p) => p.id),
    ["new", "a"],
  );
});
test("content fallback reuses unchanged page after native id replacement", () => {
  const next = reconcilePages({ old: saved("same", "text") }, [
    { id: "new", fingerprint: "same", number: 2 },
  ]);
  assert.equal(next.pages.new.text, "text");
});
test("missing and duplicate ids do not collide", () => {
  const counts = new Map([
      ["duplicate", 2],
      ["unique", 1],
    ]),
    seen = new Map();
  assert.equal(pageIdentity("unique", "h", counts, seen), "native:unique");
  assert.equal(pageIdentity("duplicate", "h", counts, seen), "content:h");
  assert.equal(pageIdentity("duplicate", "h", counts, seen), "content:h:2");
});
test("most specific folder profile resolves, preserving nested hierarchy", () => {
  const rules = [
    { enabled: true, source: "/storage/emulated/0/Note", output: "Supernote" },
    {
      enabled: true,
      source: "/storage/emulated/0/Note/Reflections",
      output: "Reflections",
    },
  ];
  const path = "/storage/emulated/0/Note/Reflections/nested/a.note";
  assert.equal(ruleFor(path, rules), rules[1]);
  assert.equal(mirrorPath(path, rules[1]), "Reflections/nested/a.md");
  assert.throws(() => validateSource("/storage/emulated/0/Note/../Document"));
  assert.throws(() => validateDestination("Supernote/../private"));
});
test("ambiguous rename does not guess notebook identity", () => {
  const n = { order: ["a", "b"] };
  const d = [{ id: "b" }, { id: "a" }];
  assert.equal(recognizeRename(d, [n]), n);
  assert.equal(recognizeRename(d, [n, n]), null);
});
test("partial mirror is truthful and keeps old text for edited page", () => {
  const text = buildMarkdown({
    output: "x.md",
    desired: [{ id: "a", number: 2, fingerprint: "new" }],
    pages: { a: saved("old", "previous") },
  });
  assert.match(text, /1 page\(s\) awaiting/);
  assert.match(text, /previous/);
  assert.match(text, /this page has changed/);
});
test("edited page failure and skip retain old text and explicit current-page notices",()=>{
  for(const status of ["failed","skipped"]){
    const text=buildMarkdown({output:"x.md",desired:[{id:"a",number:1,fingerprint:"new"}],pages:{a:saved("old","previous")},pageIssues:{a:{fingerprint:"new",status}}});
    assert.match(text,/previous/);assert.match(text,/this page has changed/);assert.match(text,status==="failed"?/could not be recognized/:/no current transcription is claimed/);
  }
});
