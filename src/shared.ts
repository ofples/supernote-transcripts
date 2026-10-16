/** Shared files are ordinary Markdown so default Obsidian Sync includes them.
 * Leases reduce duplicate work; local files plus delayed Sync cannot provide an
 * atomic lock or exactly-once requests. Never store credentials in these files.
 */
export const SHARED_ROOT = "Supernote Transcripts/Shared Data";
const HEADER = "<!-- nomad-transcripts-shared-v1 -->\n```json\n";
const FOOTER = "\n```\n";
const HASH = /^[a-f0-9]{64}$/;
const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;
export interface SharedIO {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<unknown>;
  /** Must fail when the destination already exists. */
  create(path: string, text: string): Promise<unknown>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  mkdir(path: string): Promise<unknown>;
}
export interface SharedQuery {
  notebookId: string;
  pageId: string;
  fingerprint: string;
  /** Hash of the entire recognition recipe, including model, prompt and glossary contents. */
  recipe: string;
}
export interface SharedResult extends SharedQuery {
  kind: "result";
  version: 1;
  text: string;
  textHash: string;
  deviceId: string;
  createdAt: number;
  nonce: string;
  recordId: string;
  path: string;
}
export interface CacheMatch {
  chosen?: SharedResult;
  /** Every other valid matching result remains independently recoverable. */
  alternatives: SharedResult[];
  invalidRecords: number;
}
export interface LeaseHandle {
  notebookId: string;
  deviceId: string;
  claimId: string;
}
interface Claim extends LeaseHandle {
  kind: "claim";
  version: 1;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  released: boolean;
}
export interface SharedOptions {
  root?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  nonce?: () => string;
  leaseMs?: number;
  settleMs?: number;
  clockSkewMs?: number;
}
export class SharedLeaseError extends Error {}
export async function sharedHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function normalRelative(value: string): string {
  const path = value.replace(/\\/g, "/");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) ||
      path.split("/").some((p) => !p || p === "." || p === "..") ||
      /[\u0000-\u001f]/.test(path)) throw new Error("Invalid shared relative path.");
  return path;
}
export async function notebookIdentity(ruleId: string, relativeNotePath: string): Promise<string> {
  const relative = normalRelative(relativeNotePath);
  if (!ruleId || !/\.note$/i.test(relative)) throw new Error("Notebook identity needs a rule ID and relative .note path.");
  // Preserve case: case-folding could attach results to a distinct notebook.
  return sharedHash(JSON.stringify(["notebook-v1", ruleId, relative]));
}
export function isSharedPath(path: string, root = SHARED_ROOT): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized === root || normalized.startsWith(`${root}/`);
}
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const time = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function queryOK(q: SharedQuery): boolean {
  return HASH.test(q.notebookId) && nonempty(q.pageId) && nonempty(q.fingerprint) && HASH.test(q.recipe);
}
function encode(value: unknown): string { return HEADER + JSON.stringify(value) + FOOTER; }
function decode(text: string): any {
  if (!text.startsWith(HEADER) || !text.endsWith(FOOTER)) throw new Error("Invalid shared record envelope.");
  const result = JSON.parse(text.slice(HEADER.length, -FOOTER.length));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid shared record.");
  return result;
}
function resultPayload(r: any) {
  return { kind: "result", version: 1, notebookId: r.notebookId, pageId: r.pageId,
    fingerprint: r.fingerprint, recipe: r.recipe, text: r.text, textHash: r.textHash,
    deviceId: r.deviceId, createdAt: r.createdAt, nonce: r.nonce };
}
function claimPayload(c: Claim): Claim {
  return { kind: "claim", version: 1, notebookId: c.notebookId, deviceId: c.deviceId,
    claimId: c.claimId, startedAt: c.startedAt, updatedAt: c.updatedAt,
    expiresAt: c.expiresAt, released: c.released };
}
function sameClaim(a: LeaseHandle, b: LeaseHandle): boolean {
  return a.notebookId === b.notebookId && a.deviceId === b.deviceId && a.claimId === b.claimId;
}
function compareClaims(a: Claim, b: Claim): number {
  return a.startedAt - b.startedAt || lexical(a.deviceId, b.deviceId) || lexical(a.claimId, b.claimId);
}
function lexical(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export class SharedNotebookCache {
  readonly root: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nonce: () => string;
  private readonly leaseMs: number;
  private readonly settleMs: number;
  private readonly clockSkewMs: number;
  // Serializes claim mutations in this instance, including an overlapping release.
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private io: SharedIO, readonly deviceId: string, options: SharedOptions = {}) {
    if (!nonempty(deviceId)) throw new Error("A device-local identity is required.");
    this.root = normalRelative(options.root ?? SHARED_ROOT);
    if (this.root.split("/").some((part) => part.startsWith("."))) throw new Error("Shared data must use an ordinary vault folder.");
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nonce = options.nonce ?? (() => Array.from(crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, "0")).join(""));
    this.leaseMs = options.leaseMs ?? 120_000;
    this.settleMs = options.settleMs ?? 1_500;
    this.clockSkewMs = options.clockSkewMs ?? 30_000;
    if (!time(this.leaseMs) || this.leaseMs < 1 || this.leaseMs > MAX_LEASE_MS || !time(this.settleMs) ||
        !time(this.clockSkewMs) || this.settleMs >= this.leaseMs)
      throw new Error("Invalid shared lease timing.");
  }
  private folder(notebookId: string): string {
    if (!HASH.test(notebookId)) throw new Error("Invalid portable notebook identity.");
    return `${this.root}/${notebookId}`;
  }
  private async ensure(path: string): Promise<void> {
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const parent = parts.slice(0, n).join("/");
      if (!await this.io.exists(parent)) {
        try { await this.io.mkdir(parent); }
        catch (error) { if (!await this.io.exists(parent)) throw error; }
      }
    }
  }
  private async files(folder: string): Promise<string[]> {
    if (!await this.io.exists(folder)) return [];
    const { files } = await this.io.list(folder);
    // Sync conflict copies are scanned too, but must validate their content hash.
    return files.filter((p) => p.startsWith(`${folder}/`) &&
      !p.slice(folder.length + 1).includes("/") && p.endsWith(".md")).sort(lexical);
  }
  private async resultFolder(query: SharedQuery): Promise<string> {
    const key = await sharedHash(JSON.stringify([query.pageId, query.fingerprint, query.recipe]));
    return `${this.folder(query.notebookId)}/results/${key}`;
  }
  async saveResult(query: SharedQuery, text: string): Promise<SharedResult> {
    if (!queryOK(query) || typeof text !== "string" || !text.trim()) throw new Error("Invalid successful shared result.");
    // Whitelist fields; callers cannot leak profile credentials or local paths.
    const payload = resultPayload({ ...query, text, textHash: await sharedHash(text),
      deviceId: this.deviceId, createdAt: this.now(), nonce: this.nonce() });
    if (!time(payload.createdAt) || !nonempty(payload.nonce)) throw new Error("Invalid shared result metadata.");
    const recordId = await sharedHash(JSON.stringify(payload));
    const folder = await this.resultFolder(query);
    const path = `${folder}/${recordId}.md`;
    const body = encode({ ...payload, recordId });
    await this.ensure(folder);
    try { await this.io.create(path, body); }
    catch (error) {
      // Identical retries are safe; never replace a differing immutable record.
      if (!await this.io.exists(path) || await this.io.read(path) !== body) throw error;
    }
    return { ...payload, kind: "result", version: 1, recordId, path };
  }
  async findResult(query: SharedQuery): Promise<CacheMatch> {
    if (!queryOK(query)) throw new Error("Invalid shared cache query.");
    const matches: SharedResult[] = [];
    let invalidRecords = 0;
    const seen = new Set<string>();
    for (const path of await this.files(await this.resultFolder(query))) {
      try {
        const r = decode(await this.io.read(path));
        if (r.kind !== "result" || r.version !== 1 || !queryOK(r) ||
            typeof r.text !== "string" || !r.text.trim() || !HASH.test(r.textHash) ||
            !nonempty(r.deviceId) || !time(r.createdAt) || !nonempty(r.nonce) || !HASH.test(r.recordId) ||
            r.notebookId !== query.notebookId || await sharedHash(r.text) !== r.textHash ||
            await sharedHash(JSON.stringify(resultPayload(r))) !== r.recordId ||
            !path.slice(path.lastIndexOf("/") + 1).startsWith(r.recordId)) throw new Error("Invalid shared result.");
        if (r.pageId !== query.pageId || r.fingerprint !== query.fingerprint || r.recipe !== query.recipe || seen.has(r.recordId)) continue;
        seen.add(r.recordId);
        matches.push({ ...resultPayload(r), kind: "result", version: 1, recordId: r.recordId, path });
      } catch { invalidRecords++; }
    }
    // Converges regardless of listing order or Sync delivery order. All choices survive.
    matches.sort((a, b) => a.createdAt - b.createdAt || lexical(a.deviceId, b.deviceId) || lexical(a.recordId, b.recordId));
    return { chosen: matches[0], alternatives: matches.slice(1), invalidRecords };
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const task = this.mutation.then(run, run);
    this.mutation = task.catch(() => {});
    return task;
  }
  private async claimPath(notebookId: string, deviceId = this.deviceId): Promise<string> {
    return `${this.folder(notebookId)}/claims/${await sharedHash(deviceId)}.md`;
  }
  private async readClaims(notebookId: string): Promise<Claim[]> {
    const now = this.now();
    const active: Claim[] = [];
    for (const path of await this.files(`${this.folder(notebookId)}/claims`)) {
      try {
        const c = decode(await this.io.read(path));
        if (c.kind !== "claim" || c.version !== 1 || c.notebookId !== notebookId ||
            !nonempty(c.deviceId) || !nonempty(c.claimId) || !time(c.startedAt) ||
            !time(c.updatedAt) || !time(c.expiresAt) || typeof c.released !== "boolean" ||
            c.startedAt > c.updatedAt || c.updatedAt > c.expiresAt ||
            c.expiresAt - c.updatedAt > MAX_LEASE_MS || c.updatedAt > now + this.clockSkewMs ||
            !path.slice(path.lastIndexOf("/") + 1).startsWith(await sharedHash(c.deviceId)))
          throw new Error("Invalid claim.");
        // Keep the skew grace period to avoid reclaiming a recently expired remote lease.
        if (!c.released && c.expiresAt + this.clockSkewMs > now) active.push(claimPayload(c));
      } catch {
        // A corrupted/unreadable claim could belong to an active worker. Fail closed.
        throw new SharedLeaseError("Shared notebook claim could not be validated. Retry after synchronization or inspect Shared Data.");
      }
    }
    return active.sort(compareClaims);
  }
  private async ownClaim(handle: LeaseHandle): Promise<Claim | undefined> {
    if (handle.deviceId !== this.deviceId) return undefined;
    const path = await this.claimPath(handle.notebookId);
    if (!await this.io.exists(path)) return undefined;
    const claim = decode(await this.io.read(path));
    return sameClaim(claim, handle) ? claim : undefined;
  }
  async acquire(notebookId: string): Promise<LeaseHandle | null> {
    return this.serial(async () => {
      // Existing active leases have priority; do not challenge them with a fresh claim.
      if ((await this.readClaims(notebookId)).length) return null;
      const now = this.now();
      const claim: Claim = { kind: "claim", version: 1, notebookId, deviceId: this.deviceId,
        claimId: this.nonce(), startedAt: now, updatedAt: now, expiresAt: now + this.leaseMs, released: false };
      if (!nonempty(claim.claimId)) throw new Error("Invalid device claim identity.");
      const path = await this.claimPath(notebookId);
      await this.ensure(path.slice(0, path.lastIndexOf("/")));
      await this.io.write(path, encode(claimPayload(claim)));
      // Allows already syncing simultaneous claims to become visible. This is not a Sync acknowledgement.
      await this.sleep(this.settleMs);
      const winner = (await this.readClaims(notebookId))[0];
      if (winner && sameClaim(winner, claim) && claim.expiresAt > this.now())
        return { notebookId, deviceId: this.deviceId, claimId: claim.claimId };
      await this.releaseOwn(claim);
      return null;
    });
  }
  /** Recheck immediately before every new paid request. */
  async checkLease(handle: LeaseHandle): Promise<boolean> {
    const own = await this.ownClaim(handle);
    if (!own || own.released || own.expiresAt <= this.now()) return false;
    const winner = (await this.readClaims(handle.notebookId))[0];
    return !!winner && sameClaim(winner, handle);
  }
  async heartbeat(handle: LeaseHandle): Promise<boolean> {
    return this.serial(async () => {
      if (!await this.checkLease(handle)) return false;
      const own = await this.ownClaim(handle);
      if (!own) return false;
      const now = this.now();
      if (now < own.updatedAt) return false;
      own.updatedAt = now;
      own.expiresAt = now + this.leaseMs;
      await this.io.write(await this.claimPath(handle.notebookId), encode(claimPayload(own)));
      return this.checkLease(handle);
    });
  }
  private async releaseOwn(handle: LeaseHandle): Promise<void> {
    const own = await this.ownClaim(handle);
    if (!own || own.released) return;
    // A tombstone is safer than deletion when delayed Sync can resurrect a file.
    own.released = true;
    await this.io.write(await this.claimPath(handle.notebookId), encode(claimPayload(own)));
  }
  /** Call after in-flight requests finish and successful results have been saved. */
  async release(handle: LeaseHandle): Promise<void> {
    return this.serial(() => this.releaseOwn(handle));
  }
}
