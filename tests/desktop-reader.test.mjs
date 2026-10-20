import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/desktop-reader.ts", "src/reader.ts"],
  outdir: "unused", bundle: true, platform: "node", format: "esm", write: false,
});
const load = (file) => import("data:text/javascript;base64," + Buffer.from(file.text).toString("base64"));
const { DesktopReadOnlySource, DesktopRangeFile, normalizeDesktopSource } =
  await load(bundle.outputFiles.find((f) => f.path.endsWith("desktop-reader.js")));
const { AndroidReadOnlySource } = await load(bundle.outputFiles.find((f) => /[\\/]reader\.js$/.test(f.path)));

function notebook({ order = [0, 1], hidden = false } = {}) {
  const chunks = [Buffer.alloc(24)];
  chunks[0].write("noteSN_FILE_VER_20260016");
  let offset = 24;
  const block = (data) => {
    const bytes = typeof data === "string" ? Buffer.from(data) : data;
    const b = Buffer.alloc(bytes.length + 4);
    b.writeUInt32LE(bytes.length); bytes.copy(b, 4);
    const address = offset; offset += b.length; chunks.push(b); return address;
  };
  const header = block("<APPLY_EQUIPMENT:N6>");
  const ink = Buffer.alloc(Math.ceil(1404 * 1872 / 128) * 2);
  for (let i = 0, left = 1404 * 1872; left; i += 2) {
    const count = Math.min(left, 128); ink[i] = 0x61; ink[i + 1] = count - 1; left -= count;
  }
  const pages = ["one", "two"].map((id) => {
    const bitmap = block(ink);
    const layer = block(`<LAYERNAME:MAINLAYER><LAYERBITMAP:${bitmap}>`);
    return block(`<PAGEID:${id}><MAINLAYER:${layer}><LAYERSEQ:MAINLAYER>` +
      (hidden ? `<LAYERINFO:[{"layerId"#0,"isVisible"#false,"isDeleted"#false}]>` : ""));
  });
  const footer = block(`<FILE_FEATURE:${header}>` + order.map((p, i) => `<PAGE${i + 1}:${pages[p]}>`).join(""));
  const tail = Buffer.alloc(4); tail.writeUInt32LE(footer); chunks.push(tail);
  return Buffer.concat(chunks);
}
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "nomad-desktop-reader-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return normalizeDesktopSource(root);
}
const digest = (b) => createHash("sha256").update(b).digest("hex");
const statRevision = (s) => `${s.mtimeMs}:${s.size}:${s.ctimeMs}:${s.ino}`;

test("absolute Windows, UNC and POSIX paths normalize without accepting traversal or relative paths", () => {
  assert.equal(normalizeDesktopSource("C:\\Cloud Files\\Notes\\"), "C:/Cloud Files/Notes");
  assert.equal(normalizeDesktopSource("C:\\"), "C:/");
  assert.equal(normalizeDesktopSource("\\\\server\\share\\Notes"), "//server/share/Notes");
  assert.equal(normalizeDesktopSource("/"), "/");
  for (const path of ["Notes", "C:Notes", "C:/Notes/../Other", "//server", "//?/C:/Notes", "/notes/./one", "C:/bad\0"]) {
    assert.throws(() => normalizeDesktopSource(path), /absolute|Invalid/);
  }
});

test("desktop scans current-vault or external folders, honors exclusions and propagates incomplete inventory", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(root + "/Branch"); await fs.mkdir(root + "/Archive"); await fs.mkdir(root + "/.hidden");
  for (const name of ["one.note", "skip.note", "Branch/two.NOTE", "Archive/old.note", ".hidden/private.note", "other.txt"])
    await fs.writeFile(root + "/" + name, "fixture");
  const visited = [];
  const source = new DesktopReadOnlySource({
    lstat: (path) => fs.lstat(path), open: (path, flags) => fs.open(path, flags),
    readdir: (path) => { visited.push(path); return fs.readdir(path); },
  });
  assert.deepEqual((await source.list(root, false, [])).map((x) => x.path), [root + "/one.note", root + "/skip.note"]);
  assert.deepEqual((await source.list(root, true, ["Archive", "skip.note"])).map((x) => x.path), [root + "/Branch/two.NOTE", root + "/one.note"]);
  assert.ok(!visited.includes(root + "/Archive"));
  assert.deepEqual((await source.list(root + "/one.note", true, [])).map((x) => x.path), [root + "/one.note"]);
  assert.deepEqual(await source.list(root + "/one.note", true, ["one.note"]), []);
  await assert.rejects(source.list(root + "/other.txt", false, []), /not a notebook/);
  const broken = new DesktopReadOnlySource({ ...fs, readdir: async () => { throw Error("Cloud folder unavailable"); } });
  await assert.rejects(broken.list(root, true, []), /Cloud folder unavailable/);
});

test("desktop and Android share page identities, fingerprints and native visible rendering without writing sources", async (t) => {
  const root = await fixture(t), path = root + "/one.note", bytes = notebook();
  await fs.writeFile(path, bytes);
  const before = await fs.stat(path), flags = [];
  const desktop = new DesktopReadOnlySource({ ...fs, open: (path, flag) => { flags.push(flag); return fs.open(path, flag); } });
  const android = new AndroidReadOnlySource({
    stat: async () => ({ type: "file", size: bytes.length, mtime: 1 }), readdir: async () => [], getUri: () => "fixture",
  }, undefined, async () => new Response(bytes));
  const a = await desktop.open(path), b = await android.open("/storage/emulated/0/Note/one.note");
  assert.deepEqual(a.descriptor.pages, b.descriptor.pages);
  assert.equal(await a.render(1), await b.render(1));
  a.close(); b.close();
  await assert.rejects(a.render(1), /closed/);
  assert.equal(digest(await fs.readFile(path)), digest(bytes));
  const after = await fs.stat(path);
  assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ctimeMs, before.ctimeMs);
  assert.ok(flags.length > 0 && flags.every((f) => f === "r"));
});

test("reorder preserves page identities and edits during open prevent stale rendering", async (t) => {
  const root = await fixture(t), path = root + "/one.note";
  await fs.writeFile(path, notebook());
  const source = new DesktopReadOnlySource(fs), old = await source.open(path);
  const before = await fs.stat(path);
  await fs.writeFile(path, notebook({ order: [1, 0] }));
  // Same-size writes can share the filesystem's observable timestamp tick on
  // Windows. Give this mutation a distinct revision without relying on sleeps.
  await fs.utimes(path, before.atime, new Date(before.mtimeMs + 2000));
  assert.notEqual(await source.revision(path), old.descriptor.revision);
  const reordered = await source.open(path);
  assert.deepEqual(reordered.descriptor.pages.map((p) => p.id), old.descriptor.pages.map((p) => p.id).reverse());
  assert.equal(reordered.descriptor.pages[0].fingerprint, old.descriptor.pages[1].fingerprint);
  await assert.rejects(old.render(1), /changed/);
  old.close(); reordered.close();
});

test("desktop reader accepts automatic check options and reports its explicit bitmap coverage", async (t) => {
  const root = await fixture(t), path = root + "/one.note";
  await fs.writeFile(path, notebook());
  const source = new DesktopReadOnlySource(fs);
  const baseline = await source.open(path, { mode: "new", recentPages: 0, previous: [] });
  assert.equal(baseline.descriptor.checkMode, "all");
  assert.equal(baseline.descriptor.checkedPageIds.length, 2);
  const next = await source.open(path, { mode: "new", recentPages: 0, previous: baseline.descriptor.pages });
  assert.equal(next.descriptor.checkMode, "new");
  assert.deepEqual(next.descriptor.checkedPageIds, []);
  assert.deepEqual(next.descriptor.pages.map(p => p.fingerprint), baseline.descriptor.pages.map(p => p.fingerprint));
  baseline.close(); next.close();
});

test("range reader skips notebook history and closes read handles on malformed blocks", async (t) => {
  const root = await fixture(t), path = root + "/large.note";
  const handle = await fs.open(path, "w");
  await handle.truncate(110 * 1024 * 1024);
  const data = Buffer.from([1, 0, 0, 0, 42]); await handle.write(data, 0, data.length, 24); await handle.close();
  const stat = await fs.stat(path), accesses = [], closed = [];
  const tracked = { ...fs, open: async (path, flags) => {
    assert.equal(flags, "r"); const h = await fs.open(path, flags);
    return { stat: () => h.stat(), read: (...args) => { accesses.push([args[2], args[3]]); return h.read(...args); }, close: async () => { closed.push(true); await h.close(); } };
  } };
  const range = new DesktopRangeFile(stat.size, path, tracked, statRevision(stat));
  let read; await range.scan([24, 24, 0], (_a, bytes) => { read = bytes; });
  assert.deepEqual([...read], [42]); assert.deepEqual(accesses, [[4, 24], [1, 28]]);
  assert.equal(closed.length, 1);
  await assert.rejects(range.scan([25], () => {}), /invalid or excessively/);
  assert.equal(closed.length, 2);
  await assert.rejects(range.scan([23], () => {}), /Invalid notebook block address/);
});

test("source changes during range reads are rejected and handles close", async (t) => {
  const root = await fixture(t), path = root + "/one.note";
  await fs.writeFile(path, notebook());
  const stat = await fs.stat(path); let closed = false, reads = 0;
  const source = new DesktopRangeFile(stat.size, path, { ...fs, open: async (p, flags) => {
    const h = await fs.open(p, flags);
    return { read: (...args) => h.read(...args), stat: async () => {
      // Synthetic metadata changes are deterministic even when the underlying
      // filesystem exposes identical timestamps for operations in one tick.
      const s = await h.stat(); if (reads++) Object.defineProperty(s, "mtimeMs", { value: s.mtimeMs + 2000 }); return s;
    }, close: async () => { closed = true; await h.close(); } };
  } }, statRevision(stat));
  await assert.rejects(source.head(), /changed while reading/); assert.equal(closed, true);
});
