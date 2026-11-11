function basename(source) {
  const clean = String(source ?? "").replace(/[\\/]+$/, "");
  return clean.slice(Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\")) + 1) || "Notebook";
}

function counts(state, fallbackTotal = 0) {
  if (!state) return { ready: 0, total: fallbackTotal };
  const total = Array.isArray(state.desired) ? state.desired.length : fallbackTotal;
  const forced = new Set(state.forcePending ?? []);
  const ready = (state.desired ?? []).filter(page => state.pages?.[page.id]?.fingerprint === page.fingerprint && !forced.has(page.id)).length;
  return { ready, total };
}

function manualRun(progress) {
  return !!(progress.running && progress.manualSources?.length && (!progress.activeSource || progress.manualSources.includes(progress.activeSource)));
}

export function activityStatus(progress, store = {}) {
  if (progress.paused && !manualRun(progress)) return "Paused";
  if (progress.running) {
    if (progress.stage?.toLowerCase().includes("check")) return "Checking";
    return "Updating";
  }
  if (progress.paused) return "Paused";
  if (progress.budgetBlocked || progress.executionBlocked || progress.stateBlocked || progress.stage === "Needs attention") return "Needs attention";
  if (Object.keys(store?.sourceIssues ?? {}).length) return "Needs attention";
  const states = Object.values(store?.notebooks ?? {});
  if (states.some(state => hasIssues(state))) return "Needs attention";
  if (store?.queue?.length) return "Waiting";
  if (states.some(state => state.status === "current" || (counts(state).total > 0 && counts(state).ready === counts(state).total))) return "Current";
  return "Idle";
}

function hasIssues(state) {
  const desired = new Map((state?.desired ?? []).map(page => [page.id, page.fingerprint]));
  const currentPageIssue = Object.entries(state?.pageIssues ?? {}).some(([id, issue]) => desired.get(id) === issue?.fingerprint && issue?.status !== "skipped");
  return !!(state?.executionIssue || state?.legacyPageFailure || ["failed", "conflict", "missing"].includes(state?.status) ||
    currentPageIssue);
}

const SOURCE_GUIDANCE = new Set([
  "Source could not be found. Check whether it moved, then choose Update.",
  "Source access was denied. Check its permissions, then choose Update.",
  "Source could not be listed. Check its location and availability, then choose Update.",
]);

function sourceIssueAction(issue) {
  return SOURCE_GUIDANCE.has(issue?.reason)
    ? issue.reason
    : "Check the source location and permissions, then choose Update.";
}

function issueAction(state, page) {
  if (page?.kind === "interrupted" || page?.kind === "lost_result") return "Review this page before deciding whether to retry or skip; the prior request may have reached the provider";
  if (page) return page.status === "skipped" ? "Review skipped page" : "Retry this page";
  if (state.executionIssue?.scope === "batch") return "Check provider and model settings, then retry";
  if (state.executionIssue?.scope === "source") return /notebook (?:content )?changed/i.test(state.executionIssue.reason ?? "")
    ? "Save the notebook, then retry"
    : "Check this source, then retry";
  if (state.legacyPageFailure) return "Retry this notebook to continue";
  if (state.status === "missing") return "Check that the source is available, then retry";
  if (state.status === "conflict") return "Open notebook details to resolve the conflict";
  return "Open notebook details to review the issue";
}

/** Safe, actionable projection of durable source and page issues. `source` is retained only
 * for the host callback; labels, actions, and copied text never expose it. */
export function unresolvedSourceIssues(store = {}) {
  return Object.entries(store?.sourceIssues ?? {}).map(([ruleId, issue]) => ({
    source: issue.source, ruleId, label: basename(issue.source), nextAction: sourceIssueAction(issue),
  }));
}

export function unresolvedIssues(store = {}) {
  const result = unresolvedSourceIssues(store);
  for (const state of Object.values(store?.notebooks ?? {})) {
    const sourceName = basename(state.source);
    const pages = state.desired ?? [];
    const byId = new Map(pages.map(page => [page.id, page]));
    const activePageIssues = Object.entries(state.pageIssues ?? {}).flatMap(([id, issue]) => {
      const page = byId.get(id);
      if (!page || issue?.fingerprint !== page.fingerprint || issue.status === "skipped") return [];
      return [{ source: state.source, pageId: id, pageNumber: page.number, label: `${sourceName} · Page ${page.number}`, nextAction: issueAction(state, issue) }];
    }).sort((a, b) => a.pageNumber - b.pageNumber);
    result.push(...activePageIssues);
    if (state.executionIssue || state.legacyPageFailure || ["failed", "conflict", "missing"].includes(state.status)) {
      result.push({ source: state.source, label: sourceName, nextAction: issueAction(state) });
    }
  }
  return result;
}

function safeReason(progress, state, outcome) {
  if (outcome === "completed") return "";
  if (progress.budgetBlocked) return "Spending limit reached; review usage or budget settings.";
  if (progress.stateBlocked) return "Saved state is unavailable; restore the state backup before continuing.";
  if (progress.executionBlocked) return "Recognition is blocked; check provider or connection settings.";
  if (hasIssues(state)) return "Notebook needs attention; open its source details, then retry.";
  if (progress.paused) return "Paused by user.";
  return outcome === "failed" ? "The update failed; open notebook details to review it." : "Paused before all pages were ready.";
}

function entryFor(source, progress, store, startedAt, endedAt, outcome) {
  const state = Object.values(store?.notebooks ?? {}).find(item => item.source === source);
  const pageTotal = progress.activePage?.source === source ? progress.activePage.total : 0;
  const { ready, total } = counts(state, pageTotal);
  return { at: endedAt, source: basename(source), ready, total, elapsedMs: Math.max(0, endedAt - startedAt), outcome, reason: safeReason(progress, state, outcome) };
}

export function createActivityLog(maxEntries = 40) {
  let entries = [];
  let active = null;
  const limit = Math.max(1, maxEntries);
  const append = entry => { entries = [...entries, entry].slice(-limit); };
  const finish = (progress, store, now) => {
    if (!active) return;
    const state = Object.values(store?.notebooks ?? {}).find(item => item.source === active.source);
    const total = state?.desired?.length ?? (progress.activePage?.source === active.source ? progress.activePage.total : 0);
    const ready = counts(state, total).ready;
    const failed = hasIssues(state) || !!progress.budgetBlocked || !!progress.executionBlocked || !!progress.stateBlocked;
    const outcome = failed ? "failed" : progress.paused ? "paused" : total > 0 && ready >= total ? "completed" : "paused";
    append(entryFor(active.source, progress, store, active.startedAt, now, outcome));
    active = null;
  };
  return {
    get entries() { return entries; },
    update(progress, store = {}, now = Date.now()) {
      if (active && (!progress.running || progress.activeSource !== active.source)) finish(progress, store, now);
      if (progress.running && progress.activeSource && !active) active = { source: progress.activeSource, startedAt: now };
      const status = activityStatus(progress, store);
      const issues = unresolvedIssues(store);
      const issueCount = `${issues.length} ${issues.length === 1 ? "issue" : "issues"}`;
      if (active) {
        const state = Object.values(store?.notebooks ?? {}).find(item => item.source === active.source);
        const current = counts(state, progress.activePage?.source === active.source ? progress.activePage.total : 0);
        const statusSource = manualRun(progress) ? "Updating" : status;
        const amount = statusSource === "Checking" ? `${progress.checked ?? 0}/${progress.total ?? 0} notebooks` : `${current.ready}/${current.total} pages`;
        const prefix = statusSource === "Paused" && issues.length ? `Paused · ${issueCount} · ` : "";
        return { status: `${prefix}${statusSource === "Paused" ? "" : `${statusSource} · `}${basename(active.source)} · ${amount}`, phase: statusSource, source: basename(active.source), ...current, checked: progress.checked ?? 0, checkTotal: progress.total ?? 0, elapsedMs: Math.max(0, now - active.startedAt), outcome: "running", issues };
      }
      const amount = status === "Checking" ? `${progress.checked ?? 0}/${progress.total ?? 0} notebooks` : status === "Updating" ? `${progress.recognized ?? 0}/${progress.total ?? 0} pages` : "";
      const visibleStatus = status === "Paused" && issues.length ? `Paused · ${issueCount}` : amount ? `${status} · ${amount}` : status;
      return { status: visibleStatus, phase: status, source: "", ready: 0, total: 0, checked: progress.checked ?? 0, checkTotal: progress.total ?? 0, elapsedMs: 0, outcome: status === "Needs attention" ? "failed" : status === "Paused" ? "paused" : status === "Current" ? "current" : status === "Checking" || status === "Updating" ? "running" : status === "Waiting" ? "waiting" : "idle", issues };
    },
    copyText() {
      return entries.map(entry => {
        const stamp = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const row = `${entry.source} · ${entry.ready}/${entry.total} pages · ${Math.floor(entry.elapsedMs / 1000)}s · ${entry.outcome}`;
        return `${stamp} · ${row}${entry.reason ? ` · ${entry.reason}` : ""}`;
      }).join("\n");
    },
  };
}
