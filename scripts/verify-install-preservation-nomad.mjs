import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) throw new Error("Pass the before-backup and after-readback directories");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const stable = (value) => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
});
const beforeData = await readFile(join(beforeDir, "data.json"), "utf8");
const afterData = await readFile(join(afterDir, "data.json"), "utf8");
const beforeManifest = await json(join(beforeDir, "manifest.json"));
const afterManifest = await json(join(afterDir, "manifest.json"));
const before = {};
const after = {};
for (const slot of ["state-a.json", "state-b.json"]) {
  before[slot] = await json(join(beforeDir, slot));
  after[slot] = await json(join(afterDir, slot));
}
const states = Object.fromEntries(Object.keys(before).map((slot) => [slot, {
  generationBefore: before[slot].generation,
  generationAfter: after[slot].generation,
  storePreserved: stable(before[slot].store) === stable(after[slot].store),
  queueBefore: before[slot].store.queue?.length ?? 0,
  queueAfter: after[slot].store.queue?.length ?? 0,
  notebookCountBefore: Object.keys(before[slot].store.notebooks ?? {}).length,
  notebookCountAfter: Object.keys(after[slot].store.notebooks ?? {}).length,
  checksummedAfter: typeof after[slot].checksum === "string",
}]));
const latest = (snapshots) => Object.values(snapshots).sort((a, b) => b.generation - a.generation)[0];
const beforeLatest = latest(before);
const afterLatest = latest(after);
console.log(JSON.stringify({
  versionBefore: beforeManifest.version,
  versionAfter: afterManifest.version,
  dataJsonUnchanged: beforeData === afterData,
  stateSlots: states,
  activeStorePreservedAcrossSlotRotation: stable(beforeLatest.store) === stable(afterLatest.store),
  fallbackStateSlotPreserved: stable(before["state-b.json"].store) === stable(after["state-b.json"].store),
  generationBefore: beforeLatest.generation,
  generationAfter: afterLatest.generation,
}, null, 2));
