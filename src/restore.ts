import { sharedHash, type SharedIO } from "./shared";
import type { NotebookState } from "./types";
import { validateStateSnapshot } from "./state";

const HEADER = "<!-- supernote-transcripts-restore-v1 -->\n```json\n";
const FOOTER = "\n```\n";
const HASH = /^[a-f0-9]{64}$/;
export interface RestorePoint {
  version: 1; notebookId: string; createdAt: string; text: string; textHash: string; recordHash: string;
  snapshot: Pick<NotebookState, "revision" | "order" | "desired" | "pages" | "deviceOcr" | "cleanedPages" | "cleanup" | "publishedPages" | "legacy">;
}
export function restorePath(notebookId: string, title: string) {
  if (!HASH.test(notebookId)) throw Error("Invalid notebook restore identity.");
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80) || "Notebook";
  return `Supernote Transcripts/History/${name}--${notebookId.slice(0, 12)}/Previous version.md`;
}
export function restoredState(point: RestorePoint, current: NotebookState): NotebookState {
  const state: NotebookState = {
    ...current, revision: point.snapshot.revision, order: point.snapshot.order,
    desired: point.snapshot.desired, pages: point.snapshot.pages, publishedHash: point.textHash,
    publishedPages: point.snapshot.publishedPages ?? point.snapshot.desired,
    status: "current", paused: true, lastSaved: point.createdAt,
  };
  for (const key of ["deviceOcr", "cleanedPages", "cleanup", "legacy"] as const) {
    delete state[key];
    if (point.snapshot[key] !== undefined) (state as any)[key] = point.snapshot[key];
  }
  for (const key of ["error", "executionIssue", "legacyPageFailure", "forcePending", "priorityPages", "pageIssues", "pageAttempts", "historyRevision"] as const) delete state[key];
  validateStateSnapshot({generation: 0, store: {version: 1, notebooks: {[state.source]: state}, queue: [], history: []}});
  return state;
}
export async function readRestore(io: SharedIO, path: string, notebookId: string, current: NotebookState): Promise<RestorePoint | undefined> {
  if (!await io.exists(path)) return;
  const raw = await io.read(path);
  if (!raw.startsWith(HEADER) || !raw.endsWith(FOOTER)) throw Error("The previous-version record is damaged. It was preserved.");
  const point = JSON.parse(raw.slice(HEADER.length, -FOOTER.length)) as RestorePoint;
  if (point.version !== 1 || point.notebookId !== notebookId || !Number.isFinite(Date.parse(point.createdAt)) ||
      typeof point.text !== "string" || !point.text.startsWith("---\nnomad_transcripts: true\n") ||
      !HASH.test(point.textHash) || await sharedHash(point.text) !== point.textHash || !point.snapshot || !HASH.test(point.recordHash))
    throw Error("The previous-version record could not be verified. It was preserved.");
  const {recordHash,...payload}=point;
  if(await sharedHash(JSON.stringify(payload))!==recordHash)throw Error("The previous-version record failed its integrity check. It was preserved.");
  restoredState(point, current);
  return point;
}
export async function writeRestore(io: SharedIO, path: string, notebookId: string, text: string, state: NotebookState) {
  if (!HASH.test(notebookId) || !text.startsWith("---\nnomad_transcripts: true\n")) throw Error("Only this notebook's managed transcript can be backed up.");
  // Exclude native paths, account data, execution controls and local rule IDs.
  const snapshot: RestorePoint["snapshot"] = {revision: state.revision, order: state.order, desired: state.desired, pages: state.pages};
  for (const key of ["deviceOcr", "cleanedPages", "cleanup", "publishedPages", "legacy"] as const)
    if (state[key] !== undefined) (snapshot as any)[key] = state[key];
  const payload = {version: 1 as const, notebookId, createdAt: new Date().toISOString(), text, textHash: await sharedHash(text), snapshot};
  const point: RestorePoint = {...payload,recordHash:await sharedHash(JSON.stringify(payload))};
  restoredState(point, state);
  if (await io.exists(path)) {
    await readRestore(io, path, notebookId, state); // Never overwrite a foreign or damaged file.
  }
  const parts = path.split("/");
  for (let n = 1; n < parts.length; n++) {
    const parent = parts.slice(0, n).join("/");
    if (!await io.exists(parent)) try { await io.mkdir(parent); } catch (error) { if (!await io.exists(parent)) throw error; }
  }
  await io.write(path, HEADER + JSON.stringify(point) + FOOTER);
}
