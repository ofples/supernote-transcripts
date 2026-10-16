import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${directory}test-artifacts`, { recursive: true });
await build({ entryPoints: [`${directory}src/shared.ts`], outfile: `${directory}test-artifacts/shared-test.mjs`,
  bundle: true, format: "esm", platform: "browser" });
const { SharedNotebookCache, SharedLeaseError, notebookIdentity, sharedHash, SHARED_ROOT, isSharedPath } =
  await import("../test-artifacts/shared-test.mjs");
const notebookId = await notebookIdentity("shared-rule", "Reflections/a.note");
const recipe = await sharedHash("model + endpoint + prompt + complete glossary contents");
const query = { notebookId, pageId: "native:1", fingerprint: "content-one", recipe };
function memoryIO(files = new Map(), folders = new Set()) {
  return { files, folders,
    exists: async (path) => files.has(path) || folders.has(path),
    read: async (path) => { if (!files.has(path)) throw Error("missing"); return files.get(path); },
    write: async (path, text) => { files.set(path, text); },
    create: async (path, text) => { if (files.has(path)) throw Error("exists"); files.set(path, text); },
    mkdir: async (path) => { if (folders.has(path)) throw Error("exists"); folders.add(path); },
    list: async (path) => ({ files: [...files.keys()].filter((p) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/")), folders: [] }),
  };
}
function fixture(io = memoryIO(), extra = {}) {
  let now = 1_000, count = 0;
  const options = { now: () => now, sleep: async () => {}, nonce: () => `nonce-${++count}`,
    leaseMs: 1_000, settleMs: 10, clockSkewMs: 50, ...extra };
  return { io, options, setTime: (v) => { now = v; },
    make: (deviceId) => new SharedNotebookCache(io, deviceId, options) };
}
function parse(text) { return JSON.parse(text.split("```json\n")[1].split("\n```\n")[0]); }
function envelope(payload) { return "<!-- nomad-transcripts-shared-v1 -->\n```json\n" + JSON.stringify(payload) + "\n```\n"; }

test("portable identity uses shared rule and relative notebook path, not source mount", async () => {
  assert.equal(await notebookIdentity("shared-rule", "Reflections\\a.note"), notebookId);
  assert.notEqual(await notebookIdentity("other-rule", "Reflections/a.note"), notebookId);
  assert.notEqual(await notebookIdentity("shared-rule", "Reflections/A.note"), notebookId);
  for (const p of ["../a.note", "C:/Notes/a.note", "/a.note", "a.md", "folder//a.note"])
    await assert.rejects(notebookIdentity("shared-rule", p));
  assert.equal(isSharedPath(SHARED_ROOT + "/notebook/results/a.md"), true);
  assert.equal(isSharedPath(SHARED_ROOT + " elsewhere/a.md"), false);
});
test("result Markdown survives another device and matches every identity component", async () => {
  const f = fixture(), a = f.make("nomad"), b = f.make("desktop");
  const saved = await a.saveResult({ ...query, apiKey: "secret", source: "C:/private/a.note" }, "# Page\nFaithful text");
  assert.match(saved.path, /\/results\/[a-f0-9]{64}\/[a-f0-9]{64}\.md$/);
  assert(!saved.path.includes(".obsidian"));
  assert(!f.io.files.get(saved.path).includes("secret"));
  assert(!f.io.files.get(saved.path).includes("C:/private"));
  const hit = await b.findResult(query);
  assert.equal(hit.chosen.text, saved.text);
  assert.equal(hit.invalidRecords, 0);
  for (const change of [{ pageId: "native:2" }, { fingerprint: "edited" }, { recipe: await sharedHash("changed model/prompt/glossary") }])
    assert.equal((await b.findResult({ ...query, ...change })).chosen, undefined);
  assert.equal((await b.findResult({ ...query, notebookId: await notebookIdentity("shared-rule", "b.note") })).chosen, undefined);
});
test("all competing results remain immutable and deterministic regardless of listing order", async () => {
  const f = fixture(), a = f.make("a"), b = f.make("b");
  const second = await b.saveResult(query, "alternative B");
  const first = await a.saveResult(query, "alternative A");
  const before = new Map(f.io.files);
  f.io.list = async () => ({ files: [...f.io.files.keys()].reverse(), folders: [] });
  const hit = await a.findResult(query);
  assert.equal(hit.chosen.recordId, first.recordId);
  assert.equal(hit.alternatives[0].recordId, second.recordId);
  assert.deepEqual(f.io.files, before);
});
test("tampered text, tuple, metadata, filename and malformed records cannot be reused", async () => {
  for (const change of [
    (r) => { r.text = "tampered"; },
    (r) => { r.recipe = "wrong"; },
    (r) => { r.pageId = "native:2"; },
    (r) => { r.deviceId = "another-device"; },
    (r) => { r.createdAt = -1; },
  ]) {
    const f = fixture(), a = f.make("a"), saved = await a.saveResult(query, "valid");
    const record = parse(f.io.files.get(saved.path));
    change(record);
    f.io.files.set(saved.path, envelope(record));
    const hit = await a.findResult(query);
    assert.equal(hit.chosen, undefined);
    assert.equal(hit.invalidRecords, 1);
  }
  const f = fixture(), a = f.make("a"), saved = await a.saveResult(query, "valid");
  const body = f.io.files.get(saved.path);
  f.io.files.delete(saved.path);
  f.io.files.set(saved.path.replace(saved.recordId, "wrong-name"), body);
  f.io.files.set(saved.path.replace(saved.recordId, "bad-json"), "not a shared record");
  assert.equal((await a.findResult(query)).invalidRecords, 2);
});
test("an identical immutable retry is safe and a record collision cannot overwrite data", async () => {
  const f = fixture(memoryIO(), { nonce: () => "constant" }), a = f.make("a");
  const saved = await a.saveResult(query, "valid");
  assert.equal((await a.saveResult(query, "valid")).recordId, saved.recordId);
  f.io.files.set(saved.path, "manual corruption");
  await assert.rejects(a.saveResult(query, "valid"), /exists/);
  assert.equal(f.io.files.get(saved.path), "manual corruption");
  await assert.rejects(a.saveResult(query, "   "));
});
test("valid Sync conflict copies are recoverable without duplicating an alternative", async () => {
  const f = fixture(), a = f.make("a"), saved = await a.saveResult(query, "valid");
  f.io.files.set(saved.path.replace(".md", " (conflict).md"), f.io.files.get(saved.path));
  const hit = await a.findResult(query);
  assert.equal(hit.chosen.recordId, saved.recordId);
  assert.equal(hit.alternatives.length, 0);
  assert.equal(hit.invalidRecords, 0);
});
test("a foreign active lease blocks acquisition, heartbeat extends it, release admits next device", async () => {
  const f = fixture(), a = f.make("a"), b = f.make("b");
  const lease = await a.acquire(notebookId);
  assert(lease);
  assert.equal(await b.acquire(notebookId), null);
  f.setTime(1_900);
  assert.equal(await a.heartbeat(lease), true);
  f.setTime(2_100);
  assert.equal(await b.acquire(notebookId), null);
  await a.release(lease);
  assert(await b.acquire(notebookId));
  assert.equal([...f.io.files.keys()].filter((p) => p.includes("/claims/")).length, 2);
});
test("crashed claims retain a skew grace period, expire, and cannot be revived by heartbeat", async () => {
  const f = fixture(), a = f.make("a"), b = f.make("b"), lease = await a.acquire(notebookId);
  f.setTime(2_000);
  assert.equal(await a.checkLease(lease), false);
  assert.equal(await a.heartbeat(lease), false);
  assert.equal(await b.acquire(notebookId), null);
  f.setTime(2_050);
  assert(await b.acquire(notebookId));
});
test("a stale handle cannot release or renew a new claim on the same device", async () => {
  const f = fixture(), a = f.make("a"), old = await a.acquire(notebookId);
  await a.release(old);
  const current = await a.acquire(notebookId);
  assert.notEqual(old.claimId, current.claimId);
  await a.release(old);
  assert.equal(await a.heartbeat(old), false);
  assert.equal(await a.checkLease(current), true);
});
test("acquisition waits for settling and gives visible simultaneous claims one deterministic winner", async () => {
  const resolvers = [];
  const f = fixture(memoryIO(), { sleep: (ms) => {
    assert.equal(ms, 10);
    return new Promise((resolve) => {
      resolvers.push(resolve);
      if (resolvers.length === 2) resolvers.forEach((r) => r());
    });
  } });
  const a = f.make("a"), b = f.make("b");
  const [leaseB, leaseA] = await Promise.all([b.acquire(notebookId), a.acquire(notebookId)]);
  assert.equal(leaseB, null);
  assert(leaseA);
  assert.equal(await a.checkLease(leaseA), true);
  assert.equal([...f.io.files.keys()].filter((p) => p.includes("/claims/")).length, 2);
});
test("a claim arriving during settling wins if it started earlier", async () => {
  const remote = fixture(), b = remote.make("b"), remoteLease = await b.acquire(notebookId);
  const local = fixture(memoryIO(), { sleep: async () => {
    for (const [path, content] of remote.io.files) local.io.files.set(path, content);
  } });
  local.setTime(1_010);
  assert.equal(await local.make("a").acquire(notebookId), null);
  assert.equal(await b.checkLease(remoteLease), true);
});
test("delayed Sync can allow duplicate requests; merged records preserve both results and leases converge", async () => {
  const localA = fixture(), localB = fixture();
  const a = localA.make("a"), b = localB.make("b");
  const [leaseA, leaseB] = await Promise.all([a.acquire(notebookId), b.acquire(notebookId)]);
  assert(leaseA && leaseB); // Explicitly documents the unavoidable duplicate-request case.
  await a.saveResult(query, "paid result A");
  await b.saveResult(query, "paid result B");
  for (const [path, text] of localA.io.files) localB.io.files.set(path, text);
  for (const [path, text] of localB.io.files) localA.io.files.set(path, text);
  assert.equal(await a.checkLease(leaseA), true);
  assert.equal(await b.checkLease(leaseB), false);
  assert.equal(await b.heartbeat(leaseB), false);
  const hitA = await a.findResult(query), hitB = await b.findResult(query);
  assert.equal(hitA.chosen.recordId, hitB.chosen.recordId);
  assert.equal(hitA.alternatives.length, 1);
  assert.equal(hitB.alternatives.length, 1);
});
test("malformed, unreadable and far-future claims block paid-work eligibility", async () => {
  const f = fixture(), a = f.make("a"), b = f.make("b"), lease = await a.acquire(notebookId);
  const path = [...f.io.files.keys()][0], body = f.io.files.get(path);
  f.io.files.set(path, "damaged claim");
  await assert.rejects(b.acquire(notebookId), SharedLeaseError);
  const record = parse(body);
  record.updatedAt = 9_000_000;
  record.expiresAt = 9_001_000;
  f.io.files.set(path, envelope(record));
  await assert.rejects(b.acquire(notebookId), SharedLeaseError);
  f.io.files.set(path, body);
  f.io.read = async () => { throw Error("temporary unreadable"); };
  await assert.rejects(b.acquire(notebookId), SharedLeaseError);
  await assert.rejects(a.checkLease(lease));
});
test("a lease that expires during settling is not returned and independent notebooks proceed", async () => {
  const f = fixture(memoryIO(), { sleep: async () => { f.setTime(2_500); } });
  assert.equal(await f.make("a").acquire(notebookId), null);
  const g = fixture(), a = g.make("a"), b = g.make("b");
  assert(await a.acquire(notebookId));
  assert(await b.acquire(await notebookIdentity("shared-rule", "different.note")));
});
test("lease configuration rejects hidden roots and invalid timing", () => {
  for (const options of [{ root: ".obsidian/shared" }, { root: "../shared" },
    { leaseMs: 0 }, { settleMs: 1_000, leaseMs: 1_000 }, { clockSkewMs: -1 }])
    assert.throws(() => new SharedNotebookCache(memoryIO(), "a", options));
});
test("page query grouping reads only that page's matching recipe records in a large notebook", async () => {
  const f = fixture(), a = f.make("a");
  for (let page = 1; page <= 40; page++)
    await a.saveResult({ ...query, pageId: `native:${page}` }, `page ${page}`);
  let reads = 0;
  const read = f.io.read;
  f.io.read = async (path) => { reads++; return read(path); };
  assert.equal((await a.findResult(query)).chosen.text, "page 1");
  assert.equal(reads, 1);
});
test("devices can use different lease durations without treating each other's claims as corrupted", async () => {
  const f = fixture(), a = new SharedNotebookCache(f.io, "a", { ...f.options, leaseMs: 2_000 }), b = f.make("b");
  const lease = await a.acquire(notebookId);
  assert(lease);
  assert.equal(await b.acquire(notebookId), null);
  f.setTime(3_050);
  assert(await b.acquire(notebookId));
});
