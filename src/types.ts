export interface Profile {
  id: string;
  name: string;
  model: string;
  endpoint: string;
  prompt: string;
  glossaries: string[];
  /** Recognition effort. Older saved profiles without this field use fast. */
  quality?: "fast" | "balanced" | "careful";
}
export interface FolderRule {
  id: string;
  enabled: boolean;
  paused?: boolean;
  /** False means explicit Update only; the device's global automatic switch still applies. */
  autoRecognize?: boolean;
  source: string;
  output: string;
  recursive: boolean;
  exclude: string[];
  profileId: string;
  sharedId?: string;
}
export interface ConfigV1 {
  version: 1;
  profiles: Profile[];
  rules: FolderRule[];
  intervalMinutes: number;
  batchPages: number;
  continuous?: boolean;
  showPageHeadings?: boolean;
}
export interface SourceEntry {
  path: string;
  relative: string;
  ruleId: string;
  profileId: string;
  output: string;
  size: number;
  mtime: number;
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
}
export interface OpenNotebook {
  descriptor: NotebookDescriptor;
  render(pageNumber: number): Promise<string>;
  readOcr?(pageNumber: number): Promise<string | undefined>;
  close(): void;
}
export interface ReadOnlySource {
  list(
    folder: string,
    recursive: boolean,
    exclude: string[],
  ): Promise<{ path: string; size: number; mtime: number }[]>;
  revision(path: string): Promise<string>;
  open(path: string): Promise<OpenNotebook>;
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
  cleanup?: DocumentCleanup;
  status: ItemStatus;
  paused?: boolean;
  error?: string;
  lastSaved?: string;
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
  progress: Progress;
  apiKey: string;
  autoEnabled: boolean;
  saveConfig(): Promise<void>;
  subscribe(listener: () => void): () => void;
  update(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  retry(): Promise<void>;
  retryPage(source: string, pageId: string): Promise<void>;
  skipPage(source: string, pageId: string): Promise<void>;
  retryNotebook(source: string): Promise<void>;
  setSourcePaused(ruleId: string, paused: boolean): Promise<void>;
  setNotebookPaused(source: string, paused: boolean): Promise<void>;
  preview(path: string, page: number): Promise<string>;
  manual(path: string, range: string, force?: boolean): Promise<void>;
  reprocessPages(source: string, range: string, outdatedOnly?: boolean): Promise<void>;
  reprocessEstimate?(source: string, range: string, outdatedOnly?: boolean): QueueEstimate;
  cleanupEstimate(source: string): QueueEstimate;
  cleanupDocument(source: string, options?: { saveCopy?: boolean }): Promise<void>;
  openOutput(path: string): Promise<void>;
  previewTranscriptRecovery(source: string): Promise<{ current: string; generated: string; output: string; revision: string }>;
  resolveTranscriptConflict(source: string, action: "replace" | "keep", expectedCurrent: string, expectedRevision?: string): Promise<{ backup?: string; output: string }>;
}
import type { CostSettings, CostSnapshot } from "./cost";
