import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../", import.meta.url));
await build({
  stdin: { contents: "export * from './src/restore'; export { validateStateSnapshot } from './src/state'; export { sharedHash } from './src/shared';", resolveDir: directory },
  outfile: `${directory}test-artifacts/restore-test.mjs`, bundle: true, format: "esm", platform: "browser",
});
const { readRestore, restorePath, restoredState, sharedHash, writeRestore } = await import("../test-artifacts/restore-test.mjs");

const source = "/storage/emulated/0/Note/Reflections/a.note";
const notebookId = "a".repeat(64);
const page = { id: "native:one", number: 1, fingerprint: "fingerprint" };
const managedText = "---\nnomad_transcripts: true\n---\n\n# a\n\nOlder text.\n";

function state(overrides = {}) {
  return {
    id: "local-notebook-id", source, ruleId: "private-rule-id", output: "Mirror/a.md", revision: "rev-1",
    order: [page.id], desired: [page], pages: { [page.id]: { number: page.number, fingerprint: page.fingerprint, text: "Older text.", recipe: "recipe" } },
    width: 1404, height: 1872, status: "current", publishedHash: "b".repeat(64), apiKey: "never-persist-this",
    accountEmail: "private@example.test", executionIssue: { scope: "source", reason: "local detail" },
    ...overrides,
  };
}

function memoryIO() {
  const files = new Map();
  return {
    files,
    io: {
      exists: async path => files.has(path),
      read: async path => files.get(path),
      write: async (path, text) => files.set(path, text),
      create: async (path, text) => { if (files.has(path)) throw Error("exists"); files.set(path, text); },
      list: async () => ({ files: [], folders: [] }),
      mkdir: async () => {},
    },
  };
}

const unpack = raw => JSON.parse(raw.slice(raw.indexOf("```json\n") + "```json\n".length, raw.lastIndexOf("\n```")));
async function pack(point) {
  const { recordHash, ...payload } = point;
  return `<!-- supernote-transcripts-restore-v1 -->\n\`\`\`json\n${JSON.stringify({ ...payload, recordHash: await sharedHash(JSON.stringify(payload)) })}\n\`\`\`\n`;
}

test("restore writes one fixed managed backup containing only transcript state", async () => {
  const { io, files } = memoryIO();
  const path = restorePath(notebookId, "a.note");
  const first = state();
  await writeRestore(io, path, notebookId, managedText, first);
  const serialized = files.get(path);
  const point = unpack(serialized);
  assert.deepEqual(Object.keys(point.snapshot).sort(), ["desired", "order", "pages", "revision"]);
  assert.doesNotMatch(JSON.stringify(point.snapshot), /source|output|ruleId|apiKey|accountEmail|executionIssue|private@example/);
  assert.equal((await readRestore(io, path, notebookId, first)).text, managedText);
});
test("restore path accepts an explicit history root and keeps its legacy default", () => {
  assert.equal(restorePath(notebookId, "a.note", "Device Data/History"), `Device Data/History/a.note--${notebookId.slice(0, 12)}/Previous version.md`);
  assert.equal(restorePath(notebookId, "a.note").startsWith("_supernote/History/"), true);
});

test("a failed replacement write preserves the existing previous-version record", async () => {
  const { io, files } = memoryIO();
  const path = restorePath(notebookId, "a");
  const current = state();
  await writeRestore(io, path, notebookId, managedText, current);
  const previousRecord = files.get(path);
  io.write = async () => { throw Error("Backup disk unavailable"); };
  await assert.rejects(writeRestore(io, path, notebookId, managedText.replace("Older text", "Newer text"), current), /Backup disk unavailable/);
  assert.equal(files.get(path), previousRecord);
  assert.equal((await readRestore(io, path, notebookId, current)).text, managedText);
});

test("foreign, damaged, and structurally malicious restore records are rejected without replacement", async () => {
  const { io, files } = memoryIO();
  const path = restorePath(notebookId, "a");
  const current = state();
  await writeRestore(io, path, notebookId, managedText, current);
  const original = files.get(path);

  const foreign = unpack(original);
  foreign.notebookId = "c".repeat(64);
  files.set(path, await pack(foreign));
  const foreignRaw = files.get(path);
  await assert.rejects(readRestore(io, path, notebookId, current), /could not be verified/);
  assert.equal(files.get(path), foreignRaw);

  files.set(path, "damaged restore record");
  const damagedRaw = files.get(path);
  await assert.rejects(readRestore(io, path, notebookId, current), /damaged/);
  assert.equal(files.get(path), damagedRaw);

  const malicious = unpack(original);
  malicious.snapshot.order = ["/storage/emulated/0/Note/Attacker/evil.note"];
  files.set(path, await pack(malicious));
  const maliciousRaw = files.get(path);
  await assert.rejects(readRestore(io, path, notebookId, current));
  assert.equal(files.get(path), maliciousRaw);
  assert.equal(current.source, source);
});

test("extra source and output fields in a record cannot redirect restored notebook identity", async () => {
  const { io, files } = memoryIO();
  const path = restorePath(notebookId, "a");
  const current = state();
  await writeRestore(io, path, notebookId, managedText, current);
  const point = unpack(files.get(path));
  point.snapshot.source = "/storage/emulated/0/Note/Attacker/evil.note";
  point.snapshot.output = "../../personal.md";
  files.set(path, await pack(point));

  const restored = restoredState(await readRestore(io, path, notebookId, current), current);
  assert.equal(restored.source, source);
  assert.equal(restored.output, "Mirror/a.md");
  assert.equal(restored.paused, true);
});
