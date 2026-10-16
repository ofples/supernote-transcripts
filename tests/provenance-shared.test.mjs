import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function bundled(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const { validateStateSnapshot, encodeStateSnapshot } = await bundled("src/state.ts");
const { SharedNotebookCache, notebookIdentity, sharedHash } = await bundled("src/shared.ts");
const h = "a".repeat(64);
function snapshot(extra = {}) {
  const source = "C:/Notes/a.note", id = "native:1", fingerprint = "page-fingerprint";
  return { generation: 1, store: { version: 1, notebooks: { [source]: {
    id: "book", source, ruleId: "rule", output: "Transcripts/a.md", revision: "1:2", order: [id],
    desired: [{ id, number: 1, fingerprint }], pages: { [id]: { fingerprint, text: "recognized", recipe: h, number: 1 } },
    status: "current", ...extra,
  } }, queue: [], history: [] } };
}
function memoryIO() {
  const files = new Map(), folders = new Set();
  return { files, exists: async p => files.has(p) || folders.has(p), read: async p => files.get(p),
    write: async (p, v) => files.set(p, v), create: async (p, v) => { if (files.has(p)) throw Error("exists"); files.set(p, v); },
    list: async p => ({ files: [...files.keys()].filter(x => x.startsWith(`${p}/`) && !x.slice(p.length + 1).includes("/")), folders: [] }),
    mkdir: async p => folders.add(p) };
}

test("old state snapshots remain valid and optional OCR/cleanup layers validate", async () => {
  assert.doesNotThrow(() => validateStateSnapshot(snapshot()));
  const s = snapshot({
    deviceOcr: { "native:1": { fingerprint: "page-fingerprint", text: "device words" } },
    cleanedPages: { "native:1": { fingerprint: "page-fingerprint", baseText: "recognized", text: "cleaned text" } },
    cleanup: { updatedAt: new Date(0).toISOString(), inputHash: h, outputHash: "b".repeat(64), model: "GPT-6 Luna", quality: "careful", provider: "subscription", basePages: [{ id: "native:1", number: 1, fingerprint: "page-fingerprint" }] },
  });
  assert.doesNotThrow(() => validateStateSnapshot(s));
  const encoded = await encodeStateSnapshot(s);
  assert.doesNotThrow(() => validateStateSnapshot(JSON.parse(encoded)));
  for (const damaged of [
    snapshot({ deviceOcr: { "native:1": { fingerprint: "wrong", text: "x" } } }),
    snapshot({ cleanedPages: { "native:1": { fingerprint: "page-fingerprint", baseText: "x".repeat(1_000_001), text: "y" } } }),
    snapshot({ cleanup: { updatedAt: "bad", inputHash: h, outputHash: h, model: "model", quality: "careful", provider: "api", basePages: [] } }),
    snapshot({ pages: { "native:1": { fingerprint: "page-fingerprint", text: "recognized", recipe: h, number: 1, recognition: { provider: "api", model: "m", quality: "fast", recognizedAt: "bad", promptHash: h, glossaryHash: h } } } }),
  ]) assert.throws(() => validateStateSnapshot(damaged), /Invalid notebook state/);
});

test("shared results without provenance retain the legacy payload hash", async () => {
  const io = memoryIO(), cache = new SharedNotebookCache(io, "device", { now: () => 100, nonce: () => "nonce" });
  const query = { notebookId: await notebookIdentity("rule", "a.note"), pageId: "native:1", fingerprint: "fp", recipe: h };
  const saved = await cache.saveResult(query, "text");
  const legacyPayload = { kind: "result", version: 1, ...query, text: "text", textHash: await sharedHash("text"), deviceId: "device", createdAt: 100, nonce: "nonce" };
  assert.equal(saved.recordId, await sharedHash(JSON.stringify(legacyPayload)));
  assert.equal(Object.hasOwn(saved, "recognition"), false);
});

test("shared results persist only validated recognition provenance and reject damaged metadata", async () => {
  const io = memoryIO(), cache = new SharedNotebookCache(io, "device", { now: () => 100, nonce: () => "nonce" });
  const query = { notebookId: await notebookIdentity("rule", "a.note"), pageId: "native:1", fingerprint: "fp", recipe: h };
  const recognition = { provider: "subscription", model: "GPT-6 Luna", quality: "balanced", recognizedAt: new Date(100).toISOString(), promptHash: h, glossaryHash: "b".repeat(64), secret: "omit" };
  const saved = await cache.saveResult(query, "recognized", recognition);
  const body = io.files.get(saved.path);
  assert(!body.includes("omit"));
  assert.deepEqual((await cache.findResult(query)).chosen.recognition, { provider: "subscription", model: recognition.model, quality: "balanced", recognizedAt: recognition.recognizedAt, promptHash: h, glossaryHash: "b".repeat(64) });
  const record = JSON.parse(body.split("```json\n")[1].split("\n```\n")[0]);
  record.recognition.promptHash = "bad";
  io.files.set(saved.path, "<!-- nomad-transcripts-shared-v1 -->\n```json\n" + JSON.stringify(record) + "\n```\n");
  const invalid = await cache.findResult(query);
  assert.equal(invalid.chosen, undefined);
  assert.equal(invalid.invalidRecords, 1);
  await assert.rejects(cache.saveResult(query, "recognized", { ...recognition, quality: "unknown" }));
});
