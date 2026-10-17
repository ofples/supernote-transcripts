import { sharedHash, SHARED_ROOT, type SharedIO } from "./shared";
import { PublicationReceipts } from "./publication";
// @ts-ignore provenance is shared with the JavaScript runtime.
import { recognitionFields, validRecognition } from "./provenance.mjs";

const HISTORY = "Supernote Transcripts/History";
const SHARED = SHARED_ROOT;
const DAY = 24 * 60 * 60 * 1000;
const MAX_FILES = 20_000;
const HASH = /^[a-f0-9]{64}$/;
const RESULT_HEADER = "<!-- nomad-transcripts-shared-v1 -->\n```json\n";
const RESULT_FOOTER = "\n```\n";
const PUBLICATION_HEADER = "<!-- supernote-publication-v2 -->\n";
type Listed = { files: string[]; folders: string[] };
export interface StorageIO {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(path: string): Promise<Listed>;
  remove(path: string): Promise<unknown>;
  rmdir?(path: string): Promise<unknown>;
  stat?(path: string): Promise<{ mtime: number; size: number } | null>;
}
export interface KnownNotebook {
  notebookId: string;
  results: { pageId: string; fingerprint: string; recipe: string; textHash?: string }[];
  publicationHashes: string[];
}
export interface StorageOptions {
  now?: number;
  knownNotebooks: KnownNotebook[];
  trackedHistory: string[];
  protectedHistory?: string[];
}
export interface StorageCandidate { path: string; text: string; bytes: number }
export interface StoragePlan {
  historyFiles: number; cacheFiles: number; bytes: number; removableFiles: number;
  removableBytes: number; candidates: StorageCandidate[]; emptyFolders: string[];
}

const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function safePath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return !!p && !p.startsWith("/") && !/^[a-z]:/i.test(p) &&
    !p.split("/").some(x => !x || x === "." || x === "..") && !/[\u0000-\u001f]/.test(p);
}
function beneath(path: string, root: string): boolean {
  const p = path.replace(/\\/g, "/");
  return p.startsWith(`${root}/`) && safePath(p);
}
async function walk(io: StorageIO, root: string): Promise<{ files: string[]; folders: string[]; overflow: boolean }> {
  const files: string[] = [], folders: string[] = [], queue = [root];
  const seen = new Set<string>();
  while (queue.length) {
    const folder = queue.shift()!;
    if (seen.has(folder) || !safePath(folder)) continue;
    seen.add(folder);
    if (!await io.exists(folder)) continue;
    const entries = await io.list(folder);
    for (const raw of entries.files) {
      const path = raw.replace(/\\/g, "/");
      if (path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes("/")) files.push(path);
      else if (!raw.includes("/")) files.push(`${folder}/${raw}`);
      if (files.length > MAX_FILES) return { files, folders, overflow: true };
    }
    for (const raw of entries.folders) {
      const path = raw.replace(/\\/g, "/");
      const child = path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes("/") ? path :
        !raw.includes("/") ? `${folder}/${raw}` : "";
      if (child && safePath(child)) { folders.push(child); queue.push(child); }
    }
    if (seen.size > MAX_FILES) return { files, folders, overflow: true };
  }
  return { files: [...new Set(files)].sort(lexical), folders: [...new Set(folders)].sort(lexical), overflow: false };
}
async function sizeOf(io: StorageIO, path: string, text: string): Promise<number> {
  const stat = await io.stat?.(path);
  return stat && Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : new TextEncoder().encode(text).length;
}
async function mtimeOf(io: StorageIO, path: string): Promise<number | undefined> {
  const stat = await io.stat?.(path);
  return stat && Number.isFinite(stat.mtime) && stat.mtime >= 0 ? stat.mtime : undefined;
}
function decodeResult(text: string): any {
  if (!text.startsWith(RESULT_HEADER) || !text.endsWith(RESULT_FOOTER)) throw Error("bad envelope");
  const v = JSON.parse(text.slice(RESULT_HEADER.length, -RESULT_FOOTER.length));
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("bad record");
  return v;
}
function resultPayload(r: any): any {
  const p = { kind: "result", version: 1, notebookId: r.notebookId, pageId: r.pageId,
    fingerprint: r.fingerprint, recipe: r.recipe, text: r.text, textHash: r.textHash,
    deviceId: r.deviceId, createdAt: r.createdAt, nonce: r.nonce };
  if (r.recognition !== undefined) {
    if (!validRecognition(r.recognition)) throw Error("bad recognition metadata");
    return { ...p, recognition: recognitionFields(r.recognition) };
  }
  return p;
}
async function validResult(io: StorageIO, path: string, notebookId: string, scannedText?: string): Promise<any> {
  const r = decodeResult(scannedText ?? await io.read(path));
  if (r.kind !== "result" || r.version !== 1 || r.notebookId !== notebookId || !HASH.test(r.notebookId) ||
      typeof r.pageId !== "string" || !r.pageId || typeof r.fingerprint !== "string" || !r.fingerprint ||
      !HASH.test(r.recipe) || typeof r.text !== "string" || !r.text.trim() || !HASH.test(r.textHash) ||
      typeof r.deviceId !== "string" || !r.deviceId || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 ||
      typeof r.nonce !== "string" || !r.nonce || !HASH.test(r.recordId) ||
      await sharedHash(r.text) !== r.textHash || await sharedHash(JSON.stringify(resultPayload(r))) !== r.recordId ||
      !path.slice(path.lastIndexOf("/") + 1).startsWith(`${r.recordId}.md`)) throw Error("invalid result");
  return r;
}

export async function inspectStorage(io: StorageIO, options: StorageOptions): Promise<StoragePlan> {
  const plan: StoragePlan = { historyFiles: 0, cacheFiles: 0, bytes: 0, removableFiles: 0,
    removableBytes: 0, candidates: [], emptyFolders: [] };
  const now = Number.isFinite(options.now) ? options.now! : Date.now();
  const known = new Map(options.knownNotebooks.map(n => [n.notebookId, n]));
  const candidatePaths = new Set<string>();
  const keep = new Set<string>();
  const observedTexts = new Map<string, string>();
  const hist = await walk(io, HISTORY), shared = await walk(io, SHARED);
  if (hist.overflow || shared.overflow) throw Error("Saved data exceeds the safe review limit of 20,000 files or folders. Nothing was removed; preserve the data and review a smaller vault copy before retrying.");

  const tracked = new Set(options.trackedHistory.filter(p => beneath(p, HISTORY)));
  const protectedHistory = new Set([...(options.protectedHistory ?? []), `${HISTORY}/Previous version.md`]);
  const historyGroups = new Map<string, { path: string; time: number }[]>();
  for (const path of hist.files) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    plan.historyFiles++;
    let text: string;
    try { text = await io.read(path); } catch { continue; }
    observedTexts.set(path, text);
    const bytes = await sizeOf(io, path, text); plan.bytes += bytes;
    if (!tracked.has(path) || protectedHistory.has(path) || /(?:^|\/)(?:previous version\.md|restore[- _]?metadata(?:[^/]*)?)$/i.test(path)) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const timestamped = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-[a-f0-9-]+)?(?:-(?:cleanup-result|recognition|transcript))?\.md$/i.test(name);
    const category = !timestamped ? undefined : /-cleanup-result\.md$/i.test(name) ? "cleanup" :
      /-recognition\.md$/i.test(name) ? "recognition" : "transcript";
    // A paid cleanup result can be the only copy of output after an interrupted save.
    // Without explicit recovery state it remains evidence, regardless of age.
    if (category === "cleanup") { keep.add(path); continue; }
    if (!category) continue;
    // Sync may replace filesystem modification times or deliver files out of
    // order. The plugin-generated filename records the backup's own time.
    const stamp = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
    const createdAt = stamp ? Date.parse(`${stamp[1]}:${stamp[2]}:${stamp[3]}.${stamp[4]}Z`) : NaN;
    if (!Number.isFinite(createdAt)) { keep.add(path); continue; }
    const key = `${path.slice(0, path.lastIndexOf("/"))}\0${category}`;
    const group = historyGroups.get(key) ?? [];
    group.push({ path, time: createdAt }); historyGroups.set(key, group);
  }
  for (const group of historyGroups.values()) {
    const max = Math.max(...group.map(x => x.time));
    for (const entry of group) if (entry.time === max) keep.add(entry.path); else candidatePaths.add(entry.path);
  }

  const cacheRecords = new Map<string, { r: any; path: string; text: string; bytes: number; mtime?: number }[]>();
  const publicationHashes = new Map<string, { paths: string[]; records: { path: string; text: string }[]; times: number[]; invalid: boolean; receipts?: any[] }>();
  for (const path of shared.files) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    plan.cacheFiles++;
    let text: string;
    try { text = await io.read(path); } catch { continue; }
    observedTexts.set(path, text);
    const bytes = await sizeOf(io, path, text); plan.bytes += bytes;
    if (!beneath(path, SHARED)) continue;
    const parts = path.split("/");
    const notebookId = parts[2], notebook = known.get(notebookId);
    if (!notebook || !HASH.test(notebookId)) continue;
    if (parts[3] === "results" && parts.length === 6) {
      try {
        const r = await validResult(io, path, notebookId, text);
        if (parts[5] !== `${r.recordId}.md`) continue; // Sync conflict copies are evidence, never cleanup targets.
        const list = cacheRecords.get(notebookId) ?? [];
        list.push({ r, path, text, bytes, mtime: await mtimeOf(io, path) }); cacheRecords.set(notebookId, list);
      } catch { /* Damaged, malformed, or conflict data stays protected. */ }
    } else if (parts[3] === "publications" && parts.length === 6 && HASH.test(parts[4])) {
      const key = `${notebookId}/${parts[4]}`;
      const group = publicationHashes.get(key) ?? { paths: [], records: [], times: [], invalid: false };
      group.paths.push(path);
      group.records.push({ path, text });
      if (!/^[a-f0-9]{64}\.md$/i.test(parts[5])) group.invalid = true;
      publicationHashes.set(key, group);
    } else if (parts[3] === "claims" || parts[3] === "mirrors" || parts[3] === "pairing") {
      // Operational and identity metadata is never a cleanup target.
    }
  }

  // Validate each publication hash folder through the same reader used by runtime.
  const receiptIO = io as unknown as SharedIO;
  for (const [key, group] of publicationHashes) {
    const [notebookId, hash] = key.split("/");
    try {
      const receipt = await new PublicationReceipts(receiptIO).findHash(notebookId, hash);
      if (!receipt || group.invalid) { group.invalid = true; continue; }
      // findHash validates every record, including causally superseded history.
      // Re-read and compare the scanned bytes before extracting all its references.
      group.receipts = [];
      for (const record of group.records) {
        if (await io.read(record.path) !== record.text || !record.text.startsWith(PUBLICATION_HEADER))
          throw Error("Publication changed during storage inspection.");
        const raw = JSON.parse(record.text.slice(PUBLICATION_HEADER.length));
        group.receipts.push(raw);
      }
      const tips = receipt.candidates ?? [receipt];
      group.times = tips.map(r => r.createdAt);
    } catch { group.invalid = true; }
  }
  const damagedPublicationNotebooks = new Set<string>();
  for (const [key, group] of publicationHashes) if (group.invalid)
    damagedPublicationNotebooks.add(key.slice(0, key.indexOf("/")));
  const newestPublication = new Map<string, number>();
  for (const [key, group] of publicationHashes) if (!group.invalid && group.times.length) {
    const notebookId = key.slice(0, key.indexOf("/"));
    newestPublication.set(notebookId, Math.max(newestPublication.get(notebookId) ?? -1, ...group.times));
  }
  const prunePublications = new Set<string>();
  for (const [key, group] of publicationHashes) {
    const [notebookId, hash] = key.split("/"), notebook = known.get(notebookId)!;
    if (group.invalid || notebook.publicationHashes.includes(hash)) continue;
    const newest = newestPublication.get(notebookId);
    if (newest === undefined || group.times.some(t => t === newest)) continue;
    // Prune whole hash folders only when every validated receipt and file is at least a week old.
    const recentFile = (await Promise.all(group.paths.map(path => mtimeOf(io, path))))
      .some(t => t !== undefined && t > now - 7 * DAY);
    if (group.times.length && group.times.every(t => t <= now - 7 * DAY) && !recentFile) {
      prunePublications.add(key);
      for (const path of group.paths) candidatePaths.add(path);
    }
  }

  // Retained receipts may reference results from old recipes that are neither current nor newest for the page.
  const publicationResultRefs = new Set<string>();
  for (const [key, group] of publicationHashes) if (!prunePublications.has(key)) {
    const notebookId = key.slice(0, key.indexOf("/"));
    for (const receipt of group.receipts ?? []) for (const result of receipt.results ?? [])
      publicationResultRefs.add(`${notebookId}\0${result.id}\0${result.fingerprint}\0${result.recipe}\0${result.textHash}`);
  }
  for (const [notebookId, records] of cacheRecords) {
    // Damaged publication metadata may hide result references; preserve this notebook's cache.
    if (damagedPublicationNotebooks.has(notebookId)) continue;
    const notebook = known.get(notebookId)!;
    const current = new Set(notebook.results.map(r => `${r.pageId}\0${r.fingerprint}\0${r.recipe}\0${r.textHash ?? ""}`));
    const pages = new Map<string, typeof records>();
    for (const item of records) {
      const group = pages.get(item.r.pageId) ?? []; group.push(item); pages.set(item.r.pageId, group);
    }
    const keepRecords = new Set<string>();
    for (const item of records) {
      if ([...current].some(k => {
        const [pageId, fingerprint, recipe, textHash] = k.split("\0");
        return item.r.pageId === pageId && item.r.fingerprint === fingerprint && item.r.recipe === recipe &&
          (!textHash || textHash === item.r.textHash);
      }) || publicationResultRefs.has(`${notebookId}\0${item.r.pageId}\0${item.r.fingerprint}\0${item.r.recipe}\0${item.r.textHash}`))
        keepRecords.add(item.path);
    }
    for (const group of pages.values()) {
      const max = Math.max(...group.map(x => x.r.createdAt));
      for (const item of group) if (item.r.createdAt === max) keepRecords.add(item.path);
    }
    for (const item of records) {
      if (keepRecords.has(item.path)) continue;
      const age = item.mtime === undefined ? item.r.createdAt : Math.max(item.mtime, item.r.createdAt);
      if (age <= now - 7 * DAY) candidatePaths.add(item.path);
    }
  }

  const changedPublicationNotebooks = new Set<string>();
  const finalCandidates = new Map<string, StorageCandidate>();
  for (const path of candidatePaths) {
    if (!safePath(path) || !(beneath(path, HISTORY) || beneath(path, SHARED)) || keep.has(path)) continue;
    let text: string;
    try { text = await io.read(path); } catch {
      const parts = path.split("/");
      if (beneath(path, SHARED) && parts[3] === "publications") changedPublicationNotebooks.add(parts[2]);
      continue;
    }
    if (text !== observedTexts.get(path)) {
      const parts = path.split("/");
      if (beneath(path, SHARED) && parts[3] === "publications") changedPublicationNotebooks.add(parts[2]);
      continue;
    }
    const bytes = await sizeOf(io, path, text);
    finalCandidates.set(path, { path, text, bytes });
  }
  for (const [path, candidate] of finalCandidates) {
    const parts = path.split("/");
    if (beneath(path, SHARED) && parts[3] === "results" && changedPublicationNotebooks.has(parts[2])) continue;
    plan.candidates.push(candidate); plan.removableFiles++; plan.removableBytes += candidate.bytes;
  }
  plan.candidates.sort((a, b) => lexical(a.path, b.path));
  const foldersToCheck = new Set<string>();
  for (const path of candidatePaths) {
    let parent = path.slice(0, path.lastIndexOf("/"));
    while (parent && (beneath(parent, HISTORY) || beneath(parent, SHARED))) {
      foldersToCheck.add(parent);
      if (parent === HISTORY || parent === SHARED) break;
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
  }
  plan.emptyFolders = [...foldersToCheck].sort((a, b) =>
    b.split("/").length - a.split("/").length || lexical(a, b));
  return plan;
}

export async function cleanStorage(io: StorageIO, plan: StoragePlan): Promise<{ removedFiles: number; removedBytes: number }> {
  let removedFiles = 0, removedBytes = 0;
  const blockedNotebooks = new Set<string>();
  const allowedFile = (path: string) => {
    const parts = path.split("/");
    return beneath(path, HISTORY) ||
      (beneath(path, SHARED) && parts.length === 6 && (parts[3] === "results" || parts[3] === "publications"));
  };
  const removeCandidate = async (candidate: StorageCandidate): Promise<boolean> => {
    const path = candidate.path.replace(/\\/g, "/");
    if (!safePath(path) || !allowedFile(path)) return false;
    try {
      if (!await io.exists(path) || await io.read(path) !== candidate.text) return false;
      await io.remove(path); removedFiles++; removedBytes += candidate.bytes; return true;
    } catch { return false; }
  };
  const publicationCandidates = plan.candidates.filter(c => {
    const path = c.path.replace(/\\/g, "/");
    return beneath(path, SHARED) && path.split("/")[3] === "publications";
  });
  // Receipts are deleted before cache results so a changed or undeletable receipt
  // can still protect the results it may reference.
  for (const candidate of publicationCandidates) {
    const removed = await removeCandidate(candidate);
    if (!removed) blockedNotebooks.add(candidate.path.replace(/\\/g, "/").split("/")[2]);
  }
  for (const candidate of plan.candidates) {
    const path = candidate.path.replace(/\\/g, "/"), parts = path.split("/");
    if (beneath(path, SHARED) && parts[3] === "publications") continue;
    if (beneath(path, SHARED) && parts[3] === "results" && blockedNotebooks.has(parts[2])) continue;
    await removeCandidate(candidate);
  }
  if (io.rmdir) for (const folder0 of plan.emptyFolders) {
    const folder = folder0.replace(/\\/g, "/");
    const parts = folder.split("/");
    const allowed = beneath(folder, HISTORY) ||
      (beneath(folder, SHARED) && (parts.length === 4 || parts.length === 5) &&
        (parts[3] === "results" || parts[3] === "publications"));
    if (!safePath(folder) || !allowed) continue;
    try {
      if (!await io.exists(folder)) continue;
      const entries = await io.list(folder);
      if (entries.files.length === 0 && entries.folders.length === 0) await io.rmdir(folder);
    } catch { /* Folder could not be proven empty; leave it in place. */ }
  }
  return { removedFiles, removedBytes };
}
