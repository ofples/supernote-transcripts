import type { ConfigV1, NotebookState, ReadOnlySource, Store } from "./types";
import type { SharedIO } from "./shared";
import { notebookIdentityFor } from "./notebook-identity";
import { PublicationReceipts } from "./publication";
import { relativeToRule, validateDestination, validateSource } from "./reconcile.mjs";

export interface PageNavigationRequest {
  outputPath: string;
  pageId: string;
  displayNumber: number;
}
export interface NotePageTarget {
  path: string;
  page: number;
  pageId: string;
  fileId?: string;
}
export interface NavigationOptions {
  config: ConfigV1;
  store: Store;
  reader: ReadOnlySource;
  readTranscript: (path: string) => Promise<string>;
  sharedIO?: SharedIO;
  sharedRoot?: string;
  platform?: "nomad" | "desktop";
}

export function validateNavigationRequest(request: PageNavigationRequest): void {
  validateDestination(request.outputPath);
  if (!/\.md$/i.test(request.outputPath) || typeof request.pageId !== "string" ||
      !request.pageId || request.pageId.length > 256 || /[\u0000-\u001f\u007f]/.test(request.pageId) ||
      !Number.isSafeInteger(request.displayNumber) || request.displayNumber < 1 || request.displayNumber > 100_000)
    throw Error("This page reference is invalid. Open its transcript and try again.");
}

export function isManagedTranscript(text: string): boolean {
  const header = /^---\r?\n([\s\S]{0,8192}?)\r?\n---(?:\r?\n|$)/.exec(text);
  return !!header && /^nomad_transcripts:\s*true\s*$/m.test(header[1]);
}

async function sourceForTranscript(request: PageNavigationRequest, options: NavigationOptions, text: string): Promise<NotebookState> {
  const all = Object.values(options.store.notebooks);
  const direct = all.filter(state => state.output === request.outputPath);
  if (direct.length > 1) throw Error("More than one notebook is assigned to this transcript. Check its mirror destinations.");
  if (direct[0]) return direct[0];
  // A desktop-generated transcript may have a different vault path. Its exact
  // shared publication receipt can bind it to the same logical local notebook.
  const candidates: NotebookState[] = [];
  if (options.sharedIO) {
    const receipts = new PublicationReceipts(options.sharedIO, options.sharedRoot);
    for (const state of all) {
      const rule = options.config.rules.find(rule => rule.id === state.ruleId);
      if (!rule) continue;
      let relative: string;
      try { relative = relativeToRule(state.source, rule); } catch { continue; }
      const id = await notebookIdentityFor(rule, state.source);
      const receipt = await receipts.find(id, text);
      if (receipt && receipt.pages.some(page => page.id === request.pageId)) candidates.push(state);
    }
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw Error("This transcript matches more than one local notebook. Check its mirror connections.");
  throw Error("The original notebook is not linked to this transcript on this device. Configure its matching mirror first.");
}

/** Resolve the current page ordinal without changing cached text, queue or notes. */
export async function resolveNotePage(request: PageNavigationRequest, options: NavigationOptions): Promise<NotePageTarget> {
  return (await resolveNotePages([request], options))[0];
}

/** Resolve a selection's pages against one immutable notebook snapshot. */
export async function resolveNotePages(requests: PageNavigationRequest[], options: NavigationOptions): Promise<NotePageTarget[]> {
  if (!Array.isArray(requests) || !requests.length || requests.length > 100)
    throw Error("Select an excerpt spanning no more than 100 notebook pages.");
  for (const item of requests) validateNavigationRequest(item);
  const request = requests[0];
  if (requests.some(item => item.outputPath !== request.outputPath) || new Set(requests.map(item => item.pageId)).size !== requests.length)
    throw Error("This selection does not identify one notebook unambiguously.");
  const text = await options.readTranscript(request.outputPath);
  if (!isManagedTranscript(text)) throw Error("Page links are available in generated Supernote transcripts.");
  const state = await sourceForTranscript(request, options, text);
  const path = validateSource(state.source, options.platform ?? "nomad");
  if (!/\.note$/i.test(path)) throw Error("The original source is not a Supernote notebook.");
  let opened;
  try { opened = await options.reader.open(path); }
  catch { throw Error("The original notebook could not be read. Check that it still exists in the Supernote Note folder."); }
  try {
    const pages = opened.descriptor.pages;
    const targets: NotePageTarget[] = [];
    for (const item of requests) {
      const matches = pages.filter(page => page.id === item.pageId);
      if (matches.length !== 1)
        throw Error("This page was removed or its identity changed. Open the original notebook or refresh its transcript.");
      const page = matches[0];
      if (!page.id.startsWith("native:") && pages.filter(other => other.fingerprint === page.fingerprint).length > 1)
        throw Error("Several pages have identical content, so this reference is ambiguous. Open the original notebook to choose the page.");
      targets.push({ path, page: page.number, pageId: page.id,
        ...(opened.descriptor.fileId ? { fileId: opened.descriptor.fileId } : {}) });
    }
    if (await options.reader.revision(path) !== opened.descriptor.revision)
      throw Error("The notebook changed while locating the page. Save it and tap the link again.");
    // displayNumber is a label from the old transcript, never a routing fallback.
    return targets;
  } finally { opened.close(); }
}

export function notePageUrl(target: NotePageTarget): string {
  const path = validateSource(target.path, "nomad");
  if (!/\.note$/i.test(path) || !Number.isSafeInteger(target.page) || target.page < 1 || target.page > 100_000)
    throw Error("The notebook page could not be opened safely.");
  return `supernote-transcripts://open-note?file=${encodeURIComponent(path)}&page=${target.page}`;
}
