import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({ entryPoints: ["src/publication.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { PublicationReceipts } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
const h = "a".repeat(64), h2 = "b".repeat(64), notebookId = "c".repeat(64);
async function sharedHash(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,"0")).join(""); }
const pages = [{ id: "native:1", number: 1, fingerprint: h }, { id: "native:2", number: 2, fingerprint: h2 }];
function io() {
  const files = new Map(), folders = new Set();
  return { files, exists: async p => files.has(p) || folders.has(p), read: async p => files.get(p),
    write: async (p, v) => files.set(p, v), create: async (p, v) => { if (files.has(p)) throw Error("exists"); files.set(p, v); },
    list: async p => ({ files: [...files.keys()].filter(x => x.startsWith(`${p}/`) && !x.slice(p.length + 1).includes("/")), folders: [] }),
    mkdir: async p => folders.add(p) };
}
function decode(body) { return JSON.parse(body.slice("<!-- supernote-publication-v2 -->\n".length)); }
const overlay = {
  cleanedPages: { "native:1": { fingerprint: h, baseText: "raw page", text: "cleaned page", ignored: "drop" } },
  cleanup: { updatedAt: new Date(1_000).toISOString(), inputHash: h, outputHash: h2, model: "GPT-6 Luna", quality: "careful", provider: "subscription", basePages: pages.map(({ id, number, fingerprint }) => ({ id, number, fingerprint })), extra: "drop" },
  extra: "drop",
};

test("publication cleanup overlay round-trips and unknown fields are stripped", async () => {
  const store = io(), receipts = new PublicationReceipts(store, () => 1000), id = notebookId;
  await receipts.save(id, "the transcript", pages, {}, overlay);
  const found = await receipts.find(id, "the transcript");
  assert.deepEqual(found.presentation, {
    cleanedPages: { "native:1": { fingerprint: h, baseText: "raw page", text: "cleaned page" } },
    cleanup: { updatedAt: new Date(1000).toISOString(), inputHash: h, outputHash: h2, model: "GPT-6 Luna", quality: "careful", provider: "subscription", basePages: pages.map(({ id, number, fingerprint }) => ({ id, number, fingerprint })) },
  });
  assert.equal("extra" in decode([...store.files.values()][0]), false);
});

test("legacy receipt hashes remain byte-compatible when cleanup overlay is absent", async () => {
  const store = io(), receipts = new PublicationReceipts(store, () => 1000), id = notebookId;
  await receipts.save(id, "the transcript", pages);
  const record = decode([...store.files.values()][0]);
  const expected = { version: 2, notebookId: id, textHash: await sharedHash("the transcript"), pages: pages.map(({ id, fingerprint }) => ({ id, fingerprint })), results: [], createdAt: 1000, supersedes: [] };
  assert.equal(record.recordId, await sharedHash(JSON.stringify(expected)));
  assert.equal(Object.hasOwn(record, "presentation"), false);
});

test("stale cleanup can carry an empty current overlay and historical base pages", async () => {
  const store = io(), receipts = new PublicationReceipts(store), id = notebookId;
  const stale = { cleanedPages: {}, cleanup: { ...overlay.cleanup, stale: true, basePages: [{ id: "native:old", number: 1, fingerprint: h }] } };
  await receipts.save(id, "edited transcript", pages, {}, stale);
  assert.equal((await receipts.find(id, "edited transcript")).presentation.cleanedPages && Object.keys((await receipts.find(id, "edited transcript")).presentation.cleanedPages).length, 0);
  assert.equal((await receipts.find(id, "edited transcript")).presentation.cleanup.stale, true);
});

test("damaged cleanup metadata cannot provide publication evidence", async () => {
  const store = io(), receipts = new PublicationReceipts(store), id = notebookId;
  await receipts.save(id, "the transcript", pages, {}, overlay);
  const [path, body] = [...store.files.entries()][0], record = decode(body);
  record.presentation.cleanup.outputHash = "invalid";
  store.files.set(path, "<!-- supernote-publication-v2 -->\n" + JSON.stringify(record) + "\n");
  assert.equal(await receipts.find(id, "the transcript"), undefined);
  await assert.rejects(receipts.save(id, "the transcript", pages, {}, overlay), /damaged/);
});

test("cleanup receipt rejects array values for immutable SHA-256 hash fields", async () => {
  for (const field of ["inputHash", "outputHash"]) {
    const store=io(),receipts=new PublicationReceipts(store),id=notebookId;
    await assert.rejects(receipts.save(id,"text",pages,{}, { ...overlay, cleanup:{...overlay.cleanup,[field]:[field==="inputHash"?h:h2]} }));
  }
});

test("invalid current page, path-like metadata, and unbounded overlays are rejected", async () => {
  const store = io(), receipts = new PublicationReceipts(store), id = notebookId;
  await assert.rejects(receipts.save(id, "text", pages, {}, { ...overlay, cleanedPages: { "native:3": { fingerprint: h, baseText: "x", text: "y" } } }));
  await assert.rejects(receipts.save(id, "text", pages, {}, { ...overlay, cleanup: { ...overlay.cleanup, basePages: [{ id: "C:/private/a.note", number: 1, fingerprint: h }] } }));
  await assert.rejects(receipts.save(id, "text", pages, {}, { ...overlay, cleanedPages: { "native:1": { fingerprint: h, baseText: "x".repeat(1_000_001), text: "y" } } }));
});
