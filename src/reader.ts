import {
  toImage,
  flattenToWhite,
  type IRenderablePage,
} from "supernote-typescript";
import { encodeDataURL, Image, ImageColorModel } from "image-js";
import { visibleSequence } from "./reader-support/visibility";
// @ts-ignore JavaScript helper is kept directly executable by node:test.
import { extractDeviceOcr, MAX_RECOGNITION_BLOCK_BYTES } from "./reader-support/device-ocr.mjs";
import { excludedRelative } from "./reconcile.mjs";
import type { ReadOnlySource, OpenNotebook, NotebookCheckOptions } from "./types";
import {
  StreamingFile,
  pairs,
  sha,
  identities,
  type ByteSource,
} from "./reader-support/stream";
export interface NativeReadFS {
  stat(path: string): Promise<{ size: number; mtime: number; type?: string }>;
  readdir(path: string): Promise<(string | { name: string; type?: string })[]>;
  getUri(path: string): string;
}
const layers = ["MAINLAYER", "LAYER1", "LAYER2", "LAYER3", "BGLAYER"];
function sourcePath(path: string) {
  const clean = path.replace(/\/+$/, "");
  if (
    !clean.startsWith("/storage/emulated/0/Note/") &&
    clean !== "/storage/emulated/0/Note"
  )
    throw new Error("Choose a source under /storage/emulated/0/Note.");
  if (
    clean.split("/").some((s) => s === "." || s === "..") ||
    /[\u0000-\u001f\\]/.test(clean)
  )
    throw new Error("Invalid source path.");
  return clean;
}
function address(s: string | undefined) {
  if (!s || s === "0") return 0;
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)))
    throw new Error("Invalid notebook address.");
  return Number(s);
}
async function records(source: ByteSource, addresses: number[], hashes?: Map<number,string>) {
  const result = new Map<number, Record<string, string>>();
  await source.scan(addresses, async (a, b) => {
    if(hashes)hashes.set(a,await sha(b));
    result.set(a, pairs(b));
  });
  return result;
}
interface IndexedPage {
  meta: Record<string, string>;
  sequence: string[];
  bitmaps: { name: string; address: number; layerName: string; hash?:string; length?:number }[];
  checks: [number,string][];
  width: number;
  height: number;
  fingerprint: string;
}
/** Index only current metadata and hashes. Journal history, recognition data,
 * vector paths, thumbnails and all-page bitmap buffers are never retained. */
export async function indexNotebook(
  source: ByteSource,
  onStage: (detail: string) => void = () => {},
  previewPage?: number,
  checkOptions?: NotebookCheckOptions,
) {
  onStage("Checking file signature");
  if (source.size < 28) throw new Error("Notebook is too short.");
  const signature = new TextDecoder().decode(await source.head());
  if (!/^(?:mark|note)SN_FILE_VER_\d{8}/.test(signature))
    throw new Error("Unsupported notebook signature.");
  onStage("Finding current notebook footer");
  const footerAddress = new DataView((await source.tail()).buffer).getUint32(
    0,
    true,
  );
  let footer: Record<string, string> = {};
  const metadataHashes = new Map<number,string>();
  onStage("Reading current page inventory");
  await source.scan([footerAddress], async (a, b) => {
    metadataHashes.set(a, await sha(b));
    for (const m of new TextDecoder()
      .decode(b)
      .matchAll(/<([^:<>]+):([^:<>]+)>/g)) {
      if (m[1] === "FILE_FEATURE" || /^PAGE\d+$/.test(m[1])) {
        if (m[1] in footer) throw new Error("Ambiguous notebook footer.");
        footer[m[1]] = m[2];
      }
    }
  });
  let entries = Object.keys(footer).filter((k) => /^PAGE\d+$/.test(k));
  const pageNumbers = new Set<number>();
  for (const key of entries) {
    if (!/^PAGE[1-9]\d*$/.test(key))
      throw new Error("Invalid notebook page key.");
    const pageNumber = Number(key.slice(4));
    if (!Number.isSafeInteger(pageNumber) || pageNumbers.has(pageNumber))
      throw new Error("Ambiguous notebook footer.");
    pageNumbers.add(pageNumber);
  }
  entries.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  if (!entries.length) throw new Error("Notebook contains no supported pages.");
  // Read-only previews need no all-page identity/fingerprint inventory. Select
  // the ordinal before loading page/layer/bitmap records, keeping sync indexing
  // on the full, unchanged path.
  if (previewPage !== undefined && (!Number.isSafeInteger(previewPage) || previewPage < 1 || previewPage > entries.length))
    throw new Error("Page number is outside this notebook.");
  const numbers = previewPage === undefined ? entries.map((_, i) => i + 1) : [previewPage];
  if (previewPage !== undefined) entries = [entries[previewPage - 1]];
  onStage("Reading page metadata");
  const headerAddress = address(footer.FILE_FEATURE) || 24;
  const metadata = await records(source, [
    headerAddress,
    ...entries.map((k) => address(footer[k])),
  ], metadataHashes);
  const header = metadata.get(headerAddress)!;
  let width = header.APPLY_EQUIPMENT === "N5" ? 1920 : 1404,
    height = header.APPLY_EQUIPMENT === "N5" ? 2560 : 1872;
  const metas = entries.map((k) => metadata.get(address(footer[k]))!);
  if (metas.every((p) => ["1090", "1270"].includes(p.ORIENTATION)))
    [width, height] = [height, width];
  if (
    metas.some((p) => ["1090", "1270"].includes(p.ORIENTATION)) &&
    !metas.every((p) => ["1090", "1270"].includes(p.ORIENTATION))
  )
    throw new Error(
      "Mixed portrait and landscape notebooks are not supported by this renderer.",
    );
  onStage("Reading layer metadata");
  const layerRecords = await records(
    source,
    metas.flatMap((p) => layers.map((l) => address(p[l]))),
    metadataHashes,
  );
  const pages: IndexedPage[] = metas.map((meta, i) => {
    const declaredSequence = (meta.LAYERSEQ || "MAINLAYER,BGLAYER").split(",");
    if (
      declaredSequence.some((l) => !layers.includes(l)) ||
      new Set(declaredSequence).size !== declaredSequence.length
    )
      throw new Error("Unsupported notebook layer sequence.");
    const sequence = visibleSequence(meta.LAYERINFO, declaredSequence);
    return {
      meta,
      sequence,
      width,
      height,
      fingerprint: "",
      checks: [...new Set([headerAddress,address(footer[entries[i]]),...sequence.map(name=>address(meta[name]))])]
        .filter(a=>metadataHashes.has(a)).map(a=>[a,metadataHashes.get(a)!] as [number,string]),
      bitmaps: sequence.map((name) => {
        const l = layerRecords.get(address(meta[name])) || {};
        if (l.LAYERPROTOCOL && l.LAYERPROTOCOL !== "RATTA_RLE")
          throw new Error("Unsupported notebook layer protocol.");
        return {
          name,
          address: address(l.LAYERBITMAP),
          layerName: l.LAYERNAME || name,
        };
      }),
    };
  });
  let ids = identities(pages.map((p) => p.meta.PAGEID), pages.map(() => ""));
  let selectedIndexes = pages.map((_, i) => i);
  let checkMode: "new" | "recent" | "all" = "all";
  const partialAutomatic = !!checkOptions && previewPage === undefined &&
    checkOptions.mode !== "all" && checkOptions.previous.length > 0;
  if (partialAutomatic && checkOptions) {
    const unavailable = () => {
      const error = new Error("Automatic check requires unique native page IDs. Run Update to check this notebook.");
      error.name = "AutomaticCheckUnavailableError";
      return error;
    };
    const current = pages.map((p) => p.meta.PAGEID ? `native:${p.meta.PAGEID}` : "");
    const previous = checkOptions.previous.map((p) => p.id);
    if (current.some((id) => !id) || new Set(current).size !== current.length ||
        previous.some((id) => !id.startsWith("native:")) || new Set(previous).size !== previous.length)
      throw unavailable();
    ids = current;
    const oldIds = new Set(previous);
    const isNew = (id: string) => !oldIds.has(id);
    const currentIds = new Set(current);
    const pendingIds = new Set((checkOptions.pendingPageIds || []).filter((id) => currentIds.has(id)));
    const newIndexes = pages.flatMap((_, i) => isNew(ids[i]) || pendingIds.has(ids[i]) ? [i] : []);
    const recentStart = Math.max(0, pages.length - Math.max(0, Math.floor(checkOptions.recentPages || 0)));
    selectedIndexes = checkOptions.mode === "new"
      ? newIndexes
      : pages.flatMap((_, i) => isNew(ids[i]) || pendingIds.has(ids[i]) || i >= recentStart ? [i] : []);
    checkMode = checkOptions.mode;
  }
  onStage("Fingerprinting current page bitmaps");
  const bitmapHashes = new Map<number, string>();
  const bitmapLengths = new Map<number, number>();
  await source.scan(
    selectedIndexes.flatMap((i) => pages[i].bitmaps.map((b) => b.address)),
    async (a, b) => {
      bitmapHashes.set(a, await sha(b));
      bitmapLengths.set(a, b.length);
    },
  );
  for(const p of pages)for(const b of p.bitmaps){b.hash=bitmapHashes.get(b.address);b.length=bitmapLengths.get(b.address);}
  const previousById = new Map((checkOptions?.previous || []).map((p) => [p.id, p.fingerprint]));
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const p = pages[pageIndex];
    if (!selectedIndexes.includes(pageIndex)) {
      p.fingerprint = previousById.get(ids[pageIndex]) || "";
      continue;
    }
    p.fingerprint = await sha(
      JSON.stringify({
        renderer: "snt-0.7.1-native-1",
        width,
        height,
        style: p.meta.PAGESTYLE || "0",
        layers: p.bitmaps.map((b) => [
          b.name,
          b.layerName,
          bitmapHashes.get(b.address) || null,
        ]),
      }),
    );
  }
  if (!partialAutomatic)
    ids = identities(pages.map((p) => p.meta.PAGEID), pages.map((p) => p.fingerprint));
  const fileId = typeof header.FILE_ID === "string" && header.FILE_ID.length > 0 &&
    header.FILE_ID.length <= 256 && !/[\u0000-\u001f\u007f]/.test(header.FILE_ID) ? header.FILE_ID : undefined;
  return { pages, ids, numbers, width, height, fileId, signature, footerAddress, checks: [...metadataHashes],
    checkMode, checkedPageIds: selectedIndexes.map((i) => ids[i]) };
}
export class AndroidReadOnlySource implements ReadOnlySource {
  constructor(
    private fs: NativeReadFS,
    private progress?: (stage: string, detail: string) => void,
    private fetcher: typeof fetch = fetch,
  ) {}
  async list(folder: string, recursive: boolean, exclude: string[]) {
    const root = sourcePath(folder);
    const out: { path: string; size: number; mtime: number }[] = [];
    const excluded = (relative: string) => excludedRelative(relative, exclude);
    const rootStat = await this.fs.stat(root);
    if (rootStat.type === "file") {
      if (!root.toLowerCase().endsWith(".note"))
        throw new Error("Selected source is not a notebook or folder.");
      return excluded(root.split("/").pop()!)
        ? []
        : [{ path: root, size: rootStat.size, mtime: rootStat.mtime }];
    }
    if (rootStat.type !== "directory")
      throw new Error("Selected source has an unsupported filesystem type.");
    const walk = async (path: string, relative: string, depth: number) => {
      if (depth > 64)
        throw new Error("Source nesting exceeds the safe scan depth.");
      for (const entry of await this.fs.readdir(path)) {
        const name = typeof entry === "string" ? entry : entry.name;
        if (!name || name.includes("/") || name === "." || name === "..")
          throw new Error("Invalid source directory entry.");
        if (name.startsWith(".")) continue;
        const rel = relative ? relative + "/" + name : name;
        if (excluded(rel)) continue;
        const next = path + "/" + name;
        const stat = await this.fs.stat(next);
        if (stat.type === "directory") {
          if (recursive) await walk(next, rel, depth + 1);
        } else if (name.toLowerCase().endsWith(".note"))
          out.push({ path: next, size: stat.size, mtime: stat.mtime });
      }
    };
    await walk(root, "", 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  async revision(path: string) {
    const s = await this.fs.stat(sourcePath(path));
    return `${s.mtime}:${s.size}`;
  }
  async open(path: string, options?: NotebookCheckOptions): Promise<OpenNotebook> {
    return this.openInternal(path, undefined, options);
  }
  async preview(path: string, page: number): Promise<string> {
    const opened = await this.openInternal(path, page);
    try { return await opened.render(page); } finally { opened.close(); }
  }
  private async openInternal(path: string, previewPage?: number, checkOptions?: NotebookCheckOptions): Promise<OpenNotebook> {
    path = sourcePath(path);
    const before = await this.fs.stat(path);
    const revision = `${before.mtime}:${before.size}`;
    let pass = "Reading notebook";
    const name = path.split("/").pop();
    const report = (detail: string) => {
      pass = detail;
      this.progress?.("Reading notebook", `${name} - ${detail}`);
    };
    const source = new StreamingFile(
      before.size,
      this.fs.getUri(path),
      this.fetcher,
      (read, size) =>
        this.progress?.(
          "Reading notebook",
          `${name} - ${pass}: ${(Math.min(read, size) / 1048576) | 0} / ${Math.ceil(size / 1048576)} MB`,
        ),
    );
    return openByteNotebook(path, revision, source, () => this.revision(path), this.progress, report, previewPage, checkOptions);
  }
}

/** Shared indexing, native page identities and renderer for Android and desktop.
 * The byte source must keep individual block reads bounded and read-only. */
export async function openByteNotebook(
  path: string,
  revision: string,
  source: ByteSource,
  readRevision: () => Promise<string>,
  progress?: (stage: string, detail: string) => void,
  report: (detail: string) => void = (detail) =>
    progress?.("Reading notebook", `${path.split("/").pop()} - ${detail}`),
  previewPage?: number,
  checkOptions?: NotebookCheckOptions,
): Promise<OpenNotebook> {
  const name = path.split("/").pop();
  const index = await indexNotebook(source, report, previewPage, checkOptions);
  if ((await readRevision()) !== revision)
    throw new Error(
      "Notebook changed while checking. Close it in Notes and retry.",
    );
  let references = 1;
  const release = () => {
    references--;
    if (references === 0) index.pages.length = 0;
  };
  const validateFork = async () => {
    if ((await readRevision()) !== revision)
      throw new Error("Notebook changed while checking. Close it in Notes and retry.");
    const signature = new TextDecoder().decode(await source.head());
    if (signature !== index.signature) {
      const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
      error.name = "SourceChangedError";
      throw error;
    }
    const footerAddress = new DataView((await source.tail()).buffer).getUint32(0, true);
    if (footerAddress !== index.footerAddress) {
      const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
      error.name = "SourceChangedError";
      throw error;
    }
    const expected = new Map<number, string>(index.checks);
    await source.scan([...expected.keys()], async (a, bytes) => {
      if ((await sha(bytes)) !== expected.get(a)) {
        const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
        error.name = "SourceChangedError";
        throw error;
      }
    });
    if ((await readRevision()) !== revision)
      throw new Error("Notebook changed while checking. Close it in Notes and retry.");
  };
  const create = (): OpenNotebook => {
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const renderPage = async (number: number, supplied?: Map<number,Uint8Array>) => {
    if (closed) throw new Error("Notebook was closed.");
    const p = index.pages[index.numbers.indexOf(number)];
    if (!p || !Number.isInteger(number))
      throw new Error("Page number is outside this notebook.");
    if ((await readRevision()) !== revision)
      throw new Error("Notebook changed before rendering.");
    let buffers = supplied;
    if (!buffers) {
      report(`Reading bitmap blocks for page ${number}`);
      buffers = new Map<number, Uint8Array>();
      const expected = new Map<number,string>([...p.checks,...p.bitmaps.filter(b=>b.hash).map(b=>[b.address,b.hash!] as [number,string])]);
      await source.scan(
        [...expected.keys(),...p.bitmaps.map((b) => b.address)],
        async (a, b) => {
          const hash = await sha(b);
          if(expected.has(a) && hash!==expected.get(a)){
            const error=new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
            error.name="SourceChangedError";throw error;
          }
          for (const bitmap of p.bitmaps) if (bitmap.address === a) {
            if (bitmap.hash && bitmap.hash !== hash) {
              const error=new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
              error.name="SourceChangedError";throw error;
            }
            bitmap.hash = hash;
            bitmap.length = b.length;
          }
          buffers!.set(a, b);
        },
      );
    }
    if (p.sequence.length && !p.bitmaps.some((b) => buffers!.get(b.address)?.length))
      throw new Error("Notebook page contains no renderable bitmap.");
    const page: IRenderablePage = { PAGESTYLE: p.meta.PAGESTYLE || "0", LAYERSEQ: p.sequence as any };
    for (const b of p.bitmaps)
      (page as any)[b.name] = { LAYERNAME: b.layerName, bitmapBuffer: buffers.get(b.address) || null };
    progress?.("Rendering", `${name} - rendering page ${number} at ${p.width} x ${p.height}`);
    const rendered = p.sequence.length
      ? (await toImage({ pageWidth: p.width, pageHeight: p.height, pages: [page] }, [1]))[0]
      : new Image(p.width, p.height, { colorModel: ImageColorModel.GREY }).fill(255);
    const image = encodeDataURL(flattenToWhite(rendered));
    if ((await readRevision()) !== revision)
      throw new Error("Notebook changed while rendering.");
    return image;
  };
  return {
    descriptor: {
      path,
      revision,
      width: index.width,
      height: index.height,
      ...(index.fileId ? { fileId: index.fileId } : {}),
      pages: index.pages.map((p, i) => ({
        id: index.ids[i],
        number: index.numbers[i],
        fingerprint: p.fingerprint,
      })),
      checkedPageIds: index.checkedPageIds,
      checkMode: index.checkMode,
    },
    fork: async () => {
      if (closed) throw new Error("Notebook was closed.");
      references++;
      let transferred = false;
      try {
        await validateFork();
        if (closed) throw new Error("Notebook was closed.");
        transferred = true;
        return create();
      } finally {
        if (!transferred) release();
      }
    },
    render: (number: number) => {
      const job = tail.then(() => renderPage(number));
      tail = job.catch(() => {});
      return job;
    },
    renderMany: (numbers: number[]) => {
      const job = tail.then(async () => {
        if (closed) throw new Error("Notebook was closed.");
        const selected = numbers.map(number => {
          const page = index.pages[index.numbers.indexOf(number)];
          if (!page || !Number.isInteger(number)) throw new Error("Page number is outside this notebook.");
          return { number, page };
        });
        const knownBytes = selected.reduce((total, { page }) => {
          const pageBytes = page.bitmaps.reduce((sum, bitmap) => sum + (bitmap.length ?? 0), 0);
          return total + pageBytes;
        }, 0);
        if (selected.length > 8 || knownBytes > 16 * 1024 * 1024) {
          const images: string[] = [];
          for (const { number } of selected) images.push(await renderPage(number));
          return images;
        }
        const expected = new Map<number,string>();
        const bitmapRefs = new Map<number, IndexedPage["bitmaps"]>();
        const rememberExpected = (address: number, hash: string) => {
          const previousHash = expected.get(address);
          if (previousHash && previousHash !== hash) {
            const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
            error.name = "SourceChangedError";
            throw error;
          }
          expected.set(address, hash);
        };
        for (const { page } of selected) {
          for (const [address, hash] of page.checks) rememberExpected(address, hash);
          for (const bitmap of page.bitmaps) {
            const refs = bitmapRefs.get(bitmap.address) ?? [];
            refs.push(bitmap);
            bitmapRefs.set(bitmap.address, refs);
            if (bitmap.hash) rememberExpected(bitmap.address, bitmap.hash);
          }
        }
        const buffers = new Map<number,Uint8Array>();
        let retainedBytes = 0;
        report(`Reading bitmap blocks for pages ${numbers.join(", ")}`);
        try {
          await source.scan([...expected.keys(), ...selected.flatMap(({ page }) => page.bitmaps.map(bitmap => bitmap.address))], async (address, bytes) => {
            const hash = await sha(bytes);
            if (expected.has(address) && hash !== expected.get(address)) {
              const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
              error.name = "SourceChangedError";
              throw error;
            }
            for (const bitmap of bitmapRefs.get(address) ?? []) {
              if (bitmap.hash && bitmap.hash !== hash) {
                const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
                error.name = "SourceChangedError";
                throw error;
              }
              bitmap.hash = hash;
              bitmap.length = bytes.length;
            }
            if (!buffers.has(address)) {
              if (retainedBytes + bytes.length > 16 * 1024 * 1024) {
                const error = new Error("Render batch exceeded its memory limit.");
                error.name = "RenderBatchLimitError";
                throw error;
              }
              retainedBytes += bytes.length;
            }
            buffers.set(address, bytes);
          });
        } catch (error) {
          if ((error as Error)?.name !== "RenderBatchLimitError") throw error;
          buffers.clear();
          const images: string[] = [];
          for (const { number } of selected) images.push(await renderPage(number));
          return images;
        }
        const images: string[] = [];
        for (const { number, page } of selected) {
          const pageBuffers = new Map<number,Uint8Array>();
          for (const bitmap of page.bitmaps) {
            const bytes = buffers.get(bitmap.address);
            if (bytes) pageBuffers.set(bitmap.address, bytes);
          }
          images.push(await renderPage(number, pageBuffers));
        }
        return images;
      });
      tail = job.catch(() => {});
      return job;
    },
    readOcr: (number: number) => {
      const job = tail.then(async () => {
        if (closed) throw new Error("Notebook was closed.");
        const p = index.pages[index.numbers.indexOf(number)];
        if (!p || !Number.isInteger(number))
          throw new Error("Page number is outside this notebook.");
        let ocrAddress: number;
        try {
          ocrAddress = address(p.meta.RECOGNTEXT);
        } catch {
          return undefined;
        }
        if (!ocrAddress) return undefined;
        if ((await readRevision()) !== revision)
          throw new Error("Notebook changed before reading recognition text.");
        if (ocrAddress < 24 || ocrAddress + 4 > source.size) return undefined;
        let text: string | undefined;
        const expected = new Map<number, string>(p.checks);
        report("Reading device OCR text");
        try {
          await source.scan([...expected.keys(), ocrAddress], async (a, bytes) => {
            if (expected.has(a) && (await sha(bytes)) !== expected.get(a)) {
              const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
              error.name = "SourceChangedError";
              throw error;
            }
            if (a === ocrAddress) {
              if (bytes.length > MAX_RECOGNITION_BLOCK_BYTES) return;
              text = extractDeviceOcr(bytes);
            }
          });
        } catch (error) {
          if ((error as Error)?.name === "SourceChangedError") throw error;
          return undefined;
        }
        if ((await readRevision()) !== revision)
          throw new Error("Notebook changed while reading recognition text.");
        return text;
      });
      tail = job.catch(() => {});
      return job;
    },
    readOcrMany: (numbers: number[]) => {
      const job = tail.then(async () => {
        if (closed) throw new Error("Notebook was closed.");
        const selected = numbers.map(number => {
          const page = index.pages[index.numbers.indexOf(number)];
          if (!page || !Number.isInteger(number)) throw new Error("Page number is outside this notebook.");
          let ocrAddress = 0;
          try { ocrAddress = address(page.meta.RECOGNTEXT); } catch { /* malformed OCR is page-local */ }
          if (ocrAddress < 24 || ocrAddress + 4 > source.size) ocrAddress = 0;
          return { page, ocrAddress };
        });
        if ((await readRevision()) !== revision)
          throw new Error("Notebook changed before reading recognition text.");
        const texts: (string | undefined)[] = selected.map(() => undefined);
        const pagesByAddress = new Map<number, number[]>();
        selected.forEach(({ ocrAddress }, i) => {
          if (!ocrAddress) return;
          const indexes = pagesByAddress.get(ocrAddress) ?? [];
          indexes.push(i);
          pagesByAddress.set(ocrAddress, indexes);
        });
        if (pagesByAddress.size) {
          report("Reading device OCR text");
          const expected = new Map<number,string>();
          for (const { page, ocrAddress } of selected) {
            if (!ocrAddress) continue;
            for (const [a, hash] of page.checks) expected.set(a, hash);
          }
          await source.scan([...expected.keys(), ...pagesByAddress.keys()], async (a, bytes) => {
            if (expected.has(a) && (await sha(bytes)) !== expected.get(a)) {
              const error = new Error("Notebook content changed after indexing. Save it in Notes and retry this notebook.");
              error.name = "SourceChangedError";
              throw error;
            }
            const indexes = pagesByAddress.get(a);
            if (!indexes || bytes.length > MAX_RECOGNITION_BLOCK_BYTES) return;
            const text = extractDeviceOcr(bytes);
            for (const i of indexes) texts[i] = text;
          });
        }
        if ((await readRevision()) !== revision)
          throw new Error("Notebook changed while reading recognition text.");
        return texts;
      });
      tail = job.catch(() => {});
      return job;
    },
    close: () => {
      if (closed) return;
      closed = true;
      release();
    },
  };
  };
  return create();
}

/** A selected-page render without indexing unrelated handwriting. */
export async function previewByteNotebook(
  path: string, page: number, revision: string, source: ByteSource,
  readRevision: () => Promise<string>,
  progress?: (stage: string, detail: string) => void,
  report?: (detail: string) => void,
): Promise<string> {
  const opened = await openByteNotebook(path, revision, source, readRevision, progress, report, page);
  try { return await opened.render(page); } finally { opened.close(); }
}
