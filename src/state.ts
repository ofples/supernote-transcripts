import type { Store } from "./types";
import { validateDestination, validateSource } from "./reconcile.mjs";
import { sharedHash } from "./shared";

export interface StateSnapshot { generation: number; store: Store; checksum?: string }
const record = (v: any): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: any) => typeof v === "string";
const nonempty = (v: any) => text(v) && !!v.trim();
const integer = (v: any, minimum = 0) => Number.isSafeInteger(v) && v >= minimum;
const optional = (v: any, check: (v: any) => boolean) => v === undefined || check(v);
const date = (v: any) => nonempty(v) && Number.isFinite(Date.parse(v));
const hash = (v: any) => text(v) && /^[a-f0-9]{64}$/.test(v);
const strings = (v: any) => Array.isArray(v) && v.every(nonempty) && new Set(v).size === v.length;
function path(v: any, source = false) {
  if (!nonempty(v)) return false;
  try { return (source ? validateSource(v) : validateDestination(v)) === v; } catch { return false; }
}
function safeKeys(v: any, depth = 0): boolean {
  if (!v || typeof v !== "object") return true;
  if (depth > 64) return false;
  return Object.entries(v).every(([key, value]) =>
    !["__proto__", "prototype", "constructor"].includes(key) && safeKeys(value, depth + 1));
}
function descriptors(v: any): boolean {
  return Array.isArray(v) && v.every((p, i) => record(p) && nonempty(p.id) && nonempty(p.fingerprint) && p.number === i + 1) &&
    new Set(v.map(p => p.id)).size === v.length;
}
function notebook(v: any, source: string): boolean {
  if (!record(v) || v.source !== source || !path(source, true) || !/\.note$/i.test(source) ||
      !nonempty(v.id) || !nonempty(v.ruleId) || !path(v.output) || !/\.md$/i.test(v.output) ||
      !text(v.revision) || !strings(v.order) || !descriptors(v.desired) || !record(v.pages) ||
      !["queued", "checking", "recognizing", "current", "failed", "partial", "missing", "conflict", "excluded"].includes(v.status)) return false;
  if (!(v.legacy === true && v.desired.length === 0) &&
      (v.order.length !== v.desired.length || v.order.some((id: string, i: number) => id !== v.desired[i].id))) return false;
  if (!Object.entries(v.pages).every(([id, p]) => record(p) && v.order.includes(id) && integer(p.number, 1) &&
      nonempty(p.text) && (nonempty(p.fingerprint) || (v.legacy === true && p.fingerprint === "" && nonempty(p.legacyRenderHash))) &&
      (nonempty(p.recipe) || (v.legacy === true && p.recipe === undefined)) &&
      optional(p.legacyRenderHash, nonempty) && optional(p.blank, x => typeof x === "boolean"))) return false;
  if (!["paused", "profileOutdated", "legacy"].every(key => optional(v[key], x => typeof x === "boolean")) ||
      !["error", "historyRevision", "legacyPageFailure"].every(key => optional(v[key], text)) ||
      !optional(v.lastSaved, date) || !optional(v.publishedHash, hash) || !optional(v.publishedPages, descriptors) ||
      !optional(v.outputOverride, x => path(x) && /\.md$/i.test(x)) ||
      !["forcePending", "priorityPages"].every(key => optional(v[key], strings))) return false;
  if (!optional(v.pageIssues, issues => record(issues) && Object.values(issues).every((p: any) => record(p) &&
      nonempty(p.fingerprint) && integer(p.number, 1) && ["failed", "skipped"].includes(p.status) &&
      nonempty(p.kind) && nonempty(p.reason) && integer(p.attempts) && date(p.updatedAt) && optional(p.force, x => typeof x === "boolean"))) ||
      !optional(v.pageAttempts, attempts => record(attempts) && Object.values(attempts).every((p: any) =>
        record(p) && nonempty(p.fingerprint) && integer(p.count))) ||
      !optional(v.executionIssue, issue => record(issue) && ["source", "batch"].includes(issue.scope) &&
        nonempty(issue.reason) && optional(issue.recipe, nonempty))) return false;
  return true;
}
/** Accept optional fields from previous versions, but never coerce damaged cache into an empty store. */
export function validateStateSnapshot(value: unknown): StateSnapshot {
  const v: any = value;
  if (!record(v) || !safeKeys(v) || !integer(v.generation) || !optional(v.checksum, hash) || !record(v.store) || v.store.version !== 1 ||
      !record(v.store.notebooks) || !Array.isArray(v.store.queue) || !Array.isArray(v.store.history) ||
      !optional(v.store.lastChecked, date) || !v.store.history.every((p: any) => path(p) && /\.md$/i.test(p)) ||
      !Object.entries(v.store.notebooks).every(([source, n]) => notebook(n, source))) throw Error("Invalid notebook state snapshot.");
  const tasks = new Set<string>();
  for (const t of v.store.queue) {
    if (!record(t) || !path(t.source, true) || !v.store.notebooks[t.source] || tasks.has(t.source) ||
        typeof t.force !== "boolean" || !optional(t.priority, x => Number.isFinite(x)) ||
        !optional(t.modified, x => Number.isFinite(x)) || !optional(t.pageIds, strings)) throw Error("Invalid notebook queue snapshot.");
    tasks.add(t.source);
  }
  return v as StateSnapshot;
}
/** Verify the complete outgoing state before replacing a recoverable slot. */
export async function encodeStateSnapshot(snapshot: StateSnapshot): Promise<string> {
  validateStateSnapshot(snapshot);
  const { generation, store } = snapshot;
  return JSON.stringify({ generation, store, checksum: await sharedHash(JSON.stringify([generation, store])) });
}
export const STATE_STORAGE_BLOCK = "Saved notebook state could not be loaded safely. Recognition is blocked to protect cached pages and transcript ownership. Restore state-a.json or state-b.json from a plugin backup, then reload Obsidian.";
/** A missing slot is different from an unreadable or malformed existing slot. */
export async function loadStateSlots(adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string> }, folder: string) {
  const slots = await Promise.all(["a", "b"].map(async suffix => {
    try {
      const p = `${folder}/state-${suffix}.json`;
      if (!await adapter.exists(p)) return { missing: true };
      const snapshot=validateStateSnapshot(JSON.parse(await adapter.read(p)));
      if(snapshot.checksum!==undefined&&snapshot.checksum!==await sharedHash(JSON.stringify([snapshot.generation,snapshot.store])))throw Error("Notebook state checksum mismatch.");
      return { snapshot };
    } catch { return { invalid: true }; }
  }));
  const valid = slots.flatMap(s => s.snapshot ? [s.snapshot] : []).sort((a, b) => b.generation - a.generation);
  if (valid.length === 2 && valid[0].generation === valid[1].generation && JSON.stringify(valid[0].store) !== JSON.stringify(valid[1].store))
    return { blocked: STATE_STORAGE_BLOCK };
  if (valid[0]) return { snapshot: valid[0] };
  return slots.every(s => s.missing) ? {} : { blocked: STATE_STORAGE_BLOCK };
}
