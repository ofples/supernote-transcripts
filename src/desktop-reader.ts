import type { FileHandle } from "fs/promises";
import type { Stats } from "fs";
import { excludedRelative } from "./reconcile.mjs";
import { openByteNotebook } from "./reader";
import type { ByteSource } from "./reader-support/stream";
import type { OpenNotebook, ReadOnlySource } from "./types";

/** Only read operations are exposed to this adapter. Node is loaded when the
 * desktop source is constructed, so mobile plugin loading does not load fs. */
export interface DesktopReadFS {
  lstat(path: string): Promise<Stats>;
  readdir(path: string): Promise<string[]>;
  open(path: string, flags: "r"): Promise<FileHandle>;
}

export function normalizeDesktopSource(value: string): string {
  if (!value || /[\u0000-\u001f]/.test(value))
    throw new Error("Invalid desktop source path.");
  const path = value.replace(/\\/g, "/");
  if (path.split("/").some((p) => p === "." || p === ".."))
    throw new Error("Invalid desktop source path.");
  if (path.startsWith("//")) {
    if (!/^\/\/[^/:?*<>|]+\/[^/:?*<>|]+(?:\/|$)/.test(path))
      throw new Error("Choose an absolute local folder or network share.");
  } else if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path)) {
    throw new Error("Choose an absolute local source path.");
  }
  const clean = path.replace(/\/+$/, "");
  return clean === "" ? "/" : /^[A-Za-z]:$/.test(clean) ? clean + "/" : clean;
}

const revisionOf = (s: Stats) => `${s.mtimeMs}:${s.size}:${s.ctimeMs}:${s.ino}`;
const MAX_BLOCK = 64 * 1024 * 1024;

/** Reads only the requested length-prefixed blocks. No notebook-sized buffer
 * or file handle survives a read operation; handles are always opened with r. */
export class DesktopRangeFile implements ByteSource {
  private readBytes = 0;
  constructor(
    public size: number,
    private path: string,
    private fs: DesktopReadFS,
    private revision: string,
    private progress?: (bytes: number, size: number) => void,
  ) {}

  private async withFile<T>(read: (handle: FileHandle) => Promise<T>): Promise<T> {
    const handle = await this.fs.open(this.path, "r");
    try {
      if (revisionOf(await handle.stat()) !== this.revision)
        throw new Error("Notebook changed before reading.");
      const result = await read(handle);
      if (revisionOf(await handle.stat()) !== this.revision)
        throw new Error("Notebook changed while reading.");
      return result;
    } finally {
      await handle.close();
    }
  }

  private async range(handle: FileHandle, offset: number, length: number) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || offset + length > this.size)
      throw new Error("Invalid notebook byte range.");
    const bytes = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(bytes, read, Math.min(length - read, 1024 * 1024), offset + read);
      if (!result.bytesRead) throw new Error("Notebook byte range ended early.");
      read += result.bytesRead;
      this.readBytes += result.bytesRead;
      this.progress?.(this.readBytes, this.size);
    }
    return bytes;
  }

  head() { return this.withFile((handle) => this.range(handle, 0, 24)); }
  tail() { return this.withFile((handle) => this.range(handle, this.size - 4, 4)); }

  async scan(addresses: number[], consume: (address: number, bytes: Uint8Array) => Promise<void> | void) {
    const sorted = [...new Set(addresses.filter((a) => a !== 0))].sort((a, b) => a - b);
    for (const address of sorted)
      if (!Number.isSafeInteger(address) || address < 24 || address + 4 > this.size)
        throw new Error("Invalid notebook block address.");
    if (!sorted.length) return;
    await this.withFile(async (handle) => {
      for (let i = 0; i < sorted.length; i++) {
        const address = sorted[i];
        const header = await this.range(handle, address, 4);
        const length = new DataView(header.buffer).getUint32(0, true);
        if (length > MAX_BLOCK || address + 4 + length > this.size)
          throw new Error("Notebook contains an invalid or excessively large individual page block.");
        if (i + 1 < sorted.length && sorted[i + 1] < address + 4 + length)
          throw new Error("Overlapping notebook blocks.");
        await consume(address, await this.range(handle, address + 4, length));
      }
    });
  }
}

export class DesktopReadOnlySource implements ReadOnlySource {
  constructor(
    private fs: DesktopReadFS = require("fs").promises,
    private progress?: (stage: string, detail: string) => void,
  ) {}

  async list(folder: string, recursive: boolean, exclude: string[]) {
    const root = normalizeDesktopSource(folder);
    const out: { path: string; size: number; mtime: number }[] = [];
    const rootStat = await this.fs.lstat(root);
    if (rootStat.isFile()) {
      if (!root.toLowerCase().endsWith(".note"))
        throw new Error("Selected source is not a notebook or folder.");
      return excludedRelative(root.split("/").pop()!, exclude) ? [] :
        [{ path: root, size: rootStat.size, mtime: rootStat.mtimeMs }];
    }
    if (!rootStat.isDirectory())
      throw new Error("Selected source has an unsupported filesystem type.");
    const walk = async (path: string, relative: string, depth: number) => {
      if (depth > 64) throw new Error("Source nesting exceeds the safe scan depth.");
      for (const name of await this.fs.readdir(path)) {
        if (!name || /[/\\\u0000-\u001f]/.test(name) || name === "." || name === "..")
          throw new Error("Invalid source directory entry.");
        if (name.startsWith(".")) continue;
        const rel = relative ? relative + "/" + name : name;
        if (excludedRelative(rel, exclude)) continue;
        const next = path.replace(/\/+$/, "") + "/" + name;
        const stat = await this.fs.lstat(next);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          if (recursive) await walk(next, rel, depth + 1);
        } else if (stat.isFile() && name.toLowerCase().endsWith(".note")) {
          out.push({ path: next, size: stat.size, mtime: stat.mtimeMs });
        }
      }
    };
    await walk(root, "", 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async revision(path: string) {
    const stat = await this.fs.lstat(normalizeDesktopSource(path));
    if (!stat.isFile()) throw new Error("Selected source is not a regular notebook.");
    return revisionOf(stat);
  }

  async open(path: string): Promise<OpenNotebook> {
    return this.openInternal(path);
  }
  async preview(path: string, page: number): Promise<string> {
    const opened = await this.openInternal(path, page);
    try { return await opened.render(page); } finally { opened.close(); }
  }
  private async openInternal(path: string, previewPage?: number): Promise<OpenNotebook> {
    path = normalizeDesktopSource(path);
    if (!path.toLowerCase().endsWith(".note"))
      throw new Error("Selected source is not a notebook.");
    const stat = await this.fs.lstat(path);
    if (!stat.isFile()) throw new Error("Selected source is not a regular notebook.");
    const revision = revisionOf(stat);
    let pass = "Reading notebook";
    const name = path.split("/").pop();
    const report = (detail: string) => {
      pass = detail;
      this.progress?.("Reading notebook", `${name} - ${detail}`);
    };
    const bytes = new DesktopRangeFile(stat.size, path, this.fs, revision, (read) =>
      this.progress?.("Reading notebook", `${name} - ${pass}: ${(read / 1048576).toFixed(1)} MB read`));
    return openByteNotebook(path, revision, bytes, () => this.revision(path), this.progress, report, previewPage);
  }
}
