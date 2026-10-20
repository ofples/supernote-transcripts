import type { AutomaticCheckMode, ConfigV1, FolderRule, NotebookCheckOptions, NotebookState, PageDescriptor } from "./types";

export function validateAutomaticCheck(value: { automaticCheck?: unknown; automaticCheckRecentPages?: unknown }): void {
  if (value.automaticCheck !== undefined && !["new", "recent", "all"].includes(value.automaticCheck as string))
    throw Error("Choose New pages, Recent edits, or All changes for automatic checks.");
  const count = value.automaticCheckRecentPages;
  if (count !== undefined && (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > 100))
    throw Error("Recent automatic checks must cover 1–100 pages.");
}

export function automaticCheckOptions(config: ConfigV1, rule: FolderRule, state?: NotebookState): NotebookCheckOptions {
  validateAutomaticCheck(config);
  validateAutomaticCheck(rule);
  return {
    mode: rule.automaticCheck ?? config.automaticCheck ?? "new",
    recentPages: rule.automaticCheckRecentPages ?? config.automaticCheckRecentPages ?? 5,
    previous: state?.desired.map(page => ({ ...page })) ?? [],
    ...(state?.automaticPending?.length ? { pendingPageIds: [...state.automaticPending] } : {}),
  };
}

export function descriptorCheckMode(mode?: AutomaticCheckMode): AutomaticCheckMode {
  return mode ?? "all";
}

export function automaticPageIds(options: NotebookCheckOptions, pages: PageDescriptor[]): Set<string> {
  const previous = new Set(options.previous.map(page => page.id));
  const pending = new Set(options.pendingPageIds ?? []);
  return new Set(pages.filter(page => options.mode === "all" || !previous.has(page.id) || pending.has(page.id) ||
    (options.mode === "recent" && page.number > pages.length - options.recentPages)).map(page => page.id));
}

export function automaticPolicyKey(options: NotebookCheckOptions): string {
  return `${options.mode}:${options.mode === "recent" ? options.recentPages : 0}`;
}
