export type AutomaticCheckMode = "new" | "recent" | "all";
export interface NotebookCheckOptions {
  mode: AutomaticCheckMode;
  recentPages: number;
  previous: PageDescriptor[];
  /** Previously discovered eligible pages awaiting completion of this policy. */
  pendingPageIds?: string[];
}
export interface Profile {
  id: string;
  name: string;
  model: string;
  endpoint: string;
  prompt: string;
  glossaries: string[];
  /** Recognition effort. Older saved profiles without this field use fast. */
  quality?: "fast" | "balanced" | "careful";
  /** Missing source-specific fields inherit the General formatting defaults. */
  preserveFormatting?: boolean;
  /** Additional visual cues; an explicit empty string suppresses inherited cues. */
  formattingGuide?: string;
}
export interface FolderRule {
  id: string;
  enabled: boolean;
  paused?: boolean;
  /** False means explicit Update only; the device's global automatic switch still applies. */
  autoRecognize?: boolean;
  /** Omitted inherits Reader; empty means the native Uncategorized category. */
  digestCategoryName?: string;
  /** Omitted values inherit this device's automatic-check defaults. */
  automaticCheck?: AutomaticCheckMode;
  automaticCheckRecentPages?: number;
  source: string;
  output: string;
  recursive: boolean;
  exclude: string[];
  profileId: string;
  sharedId?: string;
  /** Stable shared notebook identities retained when individual sources join a folder. */
  notebookIds?: Record<string, string>;
  /** Last agreed portable settings; paths and execution preferences remain local. */
  sharedBaseline?: import("./catalog").PortableMirror;
  /** Local durable intent to retry a saved settings publication. */
  sharedPending?: boolean;
  /** Causal settings history detects concurrent offline edits across Sync delivery. */
  sharedRevision?: string;
  sharedAncestors?: string[];
}
export interface ConfigV1 {
  version: 1;
  /** Shared vault-relative support-data folder; ordinary Markdown locator carries changes. */
  supportFolder?: string;
  /** Last storage-layout revision accepted on this device. */
  storageRevision?: string;
  profiles: Profile[];
  rules: FolderRule[];
  intervalMinutes: number;
  batchPages: number;
  continuous?: boolean;
  automaticCheck?: AutomaticCheckMode;
  automaticCheckRecentPages?: number;
  showPageHeadings?: boolean;
  /** Default semantic instructions used by whole-document cleanup. */
  cleanupPrompt?: string;
}
export interface SourceEntry {
  path: string;
  relative: string;
  ruleId: string;
  profileId: string;
  output: string;
  size: number;
  mtime: number;
  /** Adapter-specific freshness token, including desktop ctime and inode. */
  revision?: string;
}
export interface PageDescriptor {
  id: string;
  number: number;
  fingerprint: string;
}
export interface NotebookDescriptor {
  path: string;
  revision: string;
  pages: PageDescriptor[];
  width: number;
  height: number;
  /** Native file identity, when present in the current .note header. */
  fileId?: string;
  /** Partial automatic inventories retain old fingerprints for unchecked pages. */
  checkMode?: AutomaticCheckMode;
  checkedPageIds?: string[];
}
export interface OpenNotebook {
  descriptor: NotebookDescriptor;
  render(pageNumber: number): Promise<string>;
  /** Open an independent reader over the same verified index, when supported. */
  fork?(): Promise<OpenNotebook>;
  /** Read several verified bitmaps in one scan while preserving request order. */
  renderMany?(pageNumbers: number[]): Promise<string[]>;
  readOcr?(pageNumber: number): Promise<string | undefined>;
  /** Read OCR blocks for several pages through one verified source scan. */
  readOcrMany?(pageNumbers: number[]): Promise<(string | undefined)[]>;
  close(): void;
}
export interface ReadOnlySource {
  list(
    folder: string,
    recursive: boolean,
    exclude: string[],
  ): Promise<{ path: string; size: number; mtime: number }[]>;
  revision(path: string): Promise<string>;
  open(path: string, options?: NotebookCheckOptions): Promise<OpenNotebook>;
  preview?(path: string, pageNumber: number): Promise<string>;
}
export type ItemStatus =
  | "queued"
  | "checking"
  | "recognizing"
  | "current"
  | "failed"
  | "partial"
  | "missing"
  | "conflict"
  | "excluded";
export interface TranscriptPage {
  fingerprint: string;
  text: string;
  recipe: string;
  number: number;
  legacyRenderHash?: string;
  blank?: boolean;
  recognition?: RecognitionMetadata;
}
export interface RecognitionMetadata {
  provider: "api" | "subscription";
  model: string;
  quality: "fast" | "balanced" | "careful";
  recognizedAt: string;
  promptHash: string;
  glossaryHash: string;
}
export interface DeviceOcrPage { fingerprint: string; text: string }
export interface CleanedPage { fingerprint: string; baseText: string; text: string }
/** Human/presentation edits are separate from immutable recognition results. */
export interface EditedPage { fingerprint: string; baseText: string; text: string }
export interface PageEditConflict {
  fingerprint: string;
  number: number;
  baseText: string;
  editedText: string;
  recognizedText: string;
  reason: string;
  proposedText?: string;
}
export interface DocumentCleanup {
  updatedAt: string;
  inputHash: string;
  outputHash: string;
  model: string;
  quality: "careful";
  provider: "api" | "subscription";
  basePages: PageDescriptor[];
  stale?: boolean;
}
export interface PageIssue {
  fingerprint: string;
  number: number;
  status: "failed" | "skipped";
  kind: string;
  reason: string;
  attempts: number;
  /** Failed explicit reprocessing retained an earlier same-fingerprint result. */
  force?: boolean;
  updatedAt: string;
}
export interface NotebookState {
  id: string;
  source: string;
  ruleId: string;
  output: string;
  revision: string;
  order: string[];
  desired: PageDescriptor[];
  pages: Record<string, TranscriptPage>;
  deviceOcr?: Record<string, DeviceOcrPage>;
  cleanedPages?: Record<string, CleanedPage>;
  editedPages?: Record<string, EditedPage>;
  editConflicts?: Record<string, PageEditConflict>;
  /** One current publication baseline; not an accumulating document history. */
  publishedText?: string;
  cleanup?: DocumentCleanup;
  status: ItemStatus;
  paused?: boolean;
  error?: string;
  lastSaved?: string;
  lastAutomaticCheck?: string;
  lastFullCheck?: string;
  lastFullCheckRevision?: string;
  lastCheckMode?: AutomaticCheckMode;
  lastAutomaticPolicy?: string;
  automaticPending?: string[];
  publishedHash?: string;
  /** Last inventory published or adopted from a locally observed snapshot. */
  publishedPages?: PageDescriptor[];
  /** An explicitly selected per-notebook mirror destination. */
  outputOverride?: string;
  profileOutdated?: boolean;
  legacy?: boolean;
  historyRevision?: string;
  forcePending?: string[];
  priorityPages?: string[];
  pageIssues?: Record<string, PageIssue>;
  pageAttempts?: Record<string, { fingerprint: string; count: number }>;
  /** Old failures did not retain a reliable page ID. Explicit notebook retry only. */
  legacyPageFailure?: string;
  executionIssue?: { scope: "source" | "batch"; reason: string; recipe?: string; code?: string };
}
export interface QueueTask {
  source: string;
  force: boolean;
  /** One-time user request; stripped after restart. */
  manual?: boolean;
  priority?: number;
  modified?: number;
  pageIds?: string[];
}
export interface QueueView {
  working?: { source: string; number?: number; total?: number; stage: string };
  waiting: string[];
  paused: string[];
  attention: string[];
}
export interface NotebookChoice {
  source: string;
  relative: string;
  existingTranscripts: string[];
}
export interface Store {
  version: 1;
  notebooks: Record<string, NotebookState>;
  queue: QueueTask[];
  lastChecked?: string;
  history: string[];
}
export interface Progress {
  activeSource?: string;
  activePage?: { source: string; number: number; total: number };
  stage: string;
  detail: string;
  checked: number;
  total: number;
  recognized: number;
  reused: number;
  pending: number;
  running: boolean;
  paused: boolean;
  budgetBlocked?: string;
  executionBlocked?: string;
  /** Saved state is unreadable or could not be written; Update cannot clear this guard. */
  stateBlocked?: string;
  activePages?: number[];
  renderingContext?: boolean;
  manualSources?: string[];
}
export interface QueueEstimate {
  pages: number;
  usd?: number;
  reservationUsd?: number;
  samples: number;
  provisional: boolean;
  seconds?: number;
  requests: number;
}
export interface Controller {
  readonly sharedSettingsIssues?: { ruleId: string; name: string; fields: string[]; reason: string }[];
  refreshSharedSettings?(): Promise<void>;
  resolveSharedSettings?(ruleId: string, choice: "local" | "remote"): Promise<void>;
  readonly platform: "desktop" | "nomad";
  concurrency: number;
  provider: "api" | "subscription";
  showPageHeadings: boolean;
  readonly subscriptionStatus: { connected: boolean; status: string; email?: string };
  readonly subscriptionUsage: { requests: number; pages: number; inputTokens: number; outputTokens: number; unconfirmed: number; todayRequests: number; dailyLimit: number; day: string; bySource?: { source: string; model: string; requests: number; pages: number; inputTokens: number; outputTokens: number }[] };
  connectSubscription(): Promise<void>;
  finishSubscriptionLogin(): Promise<void>;
  disconnectSubscription(): Promise<void>;
  listModels(): Promise<{ id: string; name: string }[]>;
  listSharedMirrors(): Promise<{ id: string; name: string }[]>;
  queueEstimate(source?: string): QueueEstimate;
  readonly queueView: QueueView;
  prioritizeNotebook(source: string): Promise<void>;
  excludeNotebook(source: string): Promise<void>;
  listNotebookChoices(
    rule: FolderRule,
    findExisting?: boolean,
  ): Promise<NotebookChoice[]>;
  readonly costs: CostSnapshot;
  saveCostSettings(settings: CostSettings): Promise<void>;
  resolveUnconfirmedCosts(): Promise<void>;
  aiEnabled: boolean;
  config: ConfigV1;
  store: Store;
  readonly displayStore?: Store;
  progress: Progress;
  apiKey: string;
  autoEnabled: boolean;
  saveConfig(): Promise<void>;
  storagePreferences?(): {hideInExplorer:boolean;excludeFromSearch:boolean};
  setStoragePreferences?(preferences:{hideInExplorer:boolean;excludeFromSearch:boolean}):Promise<void>;
  subscribe(listener: () => void): () => void;
  update(): Promise<void>;
  requestRecognitionNow(target: { source?: string; ruleId?: string }): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  retry(): Promise<void>;
  retryPage(source: string, pageId: string): Promise<void>;
  skipPage(source: string, pageId: string): Promise<void>;
  retryNotebook(source: string): Promise<void>;
  forceUpdate?(source: string, options?: {reRecognizeAll?:boolean}): Promise<{backup?:string}>;
  forceUpdateEstimate?(source:string,reRecognizeAll?:boolean):QueueEstimate;
  setSourcePaused(ruleId: string, paused: boolean): Promise<void>;
  setNotebookPaused(source: string, paused: boolean): Promise<void>;
  preview(path: string, page: number): Promise<string>;
  manual(path: string, range: string, force?: boolean): Promise<void>;
  reprocessPages(source: string, range: string, outdatedOnly?: boolean): Promise<void>;
  reprocessEstimate?(source: string, range: string, outdatedOnly?: boolean): QueueEstimate;
  cleanupEstimate(source: string, options?: { model?: string; extraInstructions?: string; removePageComments?: boolean }): QueueEstimate;
  cleanupDocument(source: string, options?: { saveCopy?: boolean; copyPath?: string; model?: string; extraInstructions?: string; removePageComments?: boolean }): Promise<void>;
  pageSelectionPreview?(source: string, start?: number, count?: number): Promise<{ number: number; text: string; origin: "device-ocr" | "recognized" | "empty" }[]>;
  lastVersion?(source: string): Promise<{ path: string; createdAt: string } | undefined>;
  restoreLastVersion?(source: string): Promise<void>;
  storageSummary?(): Promise<{ historyFiles: number; cacheFiles: number; bytes: number; removableFiles: number; removableBytes: number }>;
  pruneStorage?(): Promise<{ removedFiles: number; removedBytes: number }>;
  openOutput(path: string): Promise<void>;
  getReconciliationConflicts(source: string): (PageEditConflict & { pageId: string })[];
  resolveReconciliationConflict(source: string, pageId: string, choice: "keep-edits" | "use-recognition" | "use-proposal", expectedFingerprint: string, expectedEditedText: string): Promise<void>;
  previewTranscriptRecovery(source: string): Promise<{ current: string; generated: string; output: string; revision: string }>;
  resolveTranscriptConflict(source: string, action: "replace" | "keep", expectedCurrent: string, expectedRevision?: string): Promise<{ backup?: string; output: string }>;
}
import type { CostSettings, CostSnapshot } from "./cost";
