import { excluded } from "./reconcile.mjs";
export class AsyncActionGate {
  active = new Set();
  run(key, action) {
    if (this.active.has(key)) return undefined;
    this.active.add(key);
    return Promise.resolve()
      .then(action)
      .finally(() => this.active.delete(key));
  }
}
export function rollbackConfigEntry(collection, id, expectedCurrent, previous, previousIndex = collection.length) {
  const index = collection.findIndex((item) => item.id === id);
  if (expectedCurrent === undefined ? index >= 0 : index < 0 || collection[index] !== expectedCurrent)
    return false;
  if (previous) {
    if (index >= 0) collection[index] = previous;
    else collection.splice(Math.min(previousIndex, collection.length), 0, previous);
  } else if (index >= 0) collection.splice(index, 1);
  return true;
}
// User-facing state is derived from page content, never from a queue task count.
export const selectedForRule = (rule, state) =>
  state.ruleId === rule.id &&
  state.status !== "excluded" &&
  (!rule.source ||
    !state.source ||
    !excluded(state.source, rule.source, rule.exclude ?? []));
export function canRecoverTranscriptEdits(state) {
  const error = String(state?.error ?? "");
  return (
    state?.status === "conflict" &&
    !/shared transcript|publication receipt|synchronization|cloud snapshot/i.test(
      error,
    ) &&
    /manually edited|manual edit|ownership record/i.test(error)
  );
}
export function attentionReason(state) {
  if (
    state.executionIssue?.scope === "source" &&
    /notebook (?:content )?changed/i.test(state.executionIssue.reason ?? "")
  )
    return "Save the notebook, then retry this notebook.";
  if (state.executionIssue?.scope === "source")
    return "Check this source, then retry the notebook.";
  if (state.executionIssue?.scope === "batch")
    return "Check provider and model settings, then retry.";
  if (!["failed", "conflict", "missing"].includes(state.status))
    return state.legacyPageFailure
      ? "Retry this notebook to continue with its remaining pages."
      : undefined;
  if (state.legacyPageFailure)
    return "Retry this notebook to continue with its remaining pages.";
  const error = String(state.error ?? "").trim();
  if (/cannot read glossary|(?:enoent|eacces).{0,150}glossar/i.test(error))
    return "Restore or reselect the glossary in mirror settings.";
  if (
    /(?:stale|older|outdated).{0,50}(?:cloud|snapshot)|(?:cloud|snapshot).{0,50}(?:stale|older|outdated)/i.test(
      error,
    )
  )
    return "Refresh the Supernote Cloud source.";
  if (
    /shared transcript.{0,100}newer or conflicting page inventory/i.test(
      error,
    )
  )
    return "Sync the original notebook to this device, then choose Update or Resume on Sources.";
  if (
    /shared transcript.{0,100}(?:not arrived|not synchronized|not synced|conflict)|shared notebook claim could not be validated|wait for (?:source )?synchronization/i.test(
      error,
    )
  )
    return "Wait for Obsidian Sync, then retry.";
  if (
    state.status === "missing" ||
    /(?:enoent|enotdir|eacces|eperm|filesystem.{0,30}unavailable|cloud folder unavailable|selected source.*unavailable|not found in the completed scan)/i.test(
      error,
    )
  )
    return "Check the source path and confirm the notebook is available.";
  if (
    /manually edited|manual edit|conflicting transcript|transcript conflict/i.test(
      error,
    )
  )
    return "Choose whether to keep edits or restore saved recognition.";
  if (error || state.status === "failed" || state.status === "conflict")
    return "Open notebook details to review the error.";
  return undefined;
}
export function currentPageIssues(state) {
  const issues = state?.pageIssues ?? {};
  const result = [];
  for (const page of state?.desired ?? []) {
    const issue = issues[page.id];
    if (!issue || issue.fingerprint !== page.fingerprint) continue;
    result.push({ ...issue, id: page.id, number: page.number });
  }
  return result.sort((a, b) => a.number - b.number);
}
const pageAttentionText = (count) =>
  `${count} ${count === 1 ? "page needs" : "pages need"} attention`;
const pagesSkippedText = (count) =>
  `${count} ${count === 1 ? "page skipped" : "pages skipped"}`;
export function notebookPresentation(state) {
  const total = state.desired.length;
  const forced = new Set(state.forcePending ?? []);
  let ready = 0,
    changed = 0,
    added = 0,
    initial = 0;
  for (const page of state.desired) {
    const cached = state.pages[page.id];
    if (cached?.fingerprint === page.fingerprint && !forced.has(page.id))
      ready++;
    else if (cached) changed++;
    else if (state.priorityPages?.includes(page.id)) added++;
    else initial++;
  }
  const pending = total - ready;
  const pageIssues = currentPageIssues(state);
  const failedPageCount = pageIssues.filter((issue) => issue.status !== "skipped").length;
  const skippedCount = pageIssues.filter((issue) => issue.status === "skipped").length;
  const actionablePending = Math.max(0, pending - skippedCount);
  const attention = state.status === "failed" || state.status === "conflict" || failedPageCount > 0 || !!state.executionIssue || !!state.legacyPageFailure;
  const reason = attentionReason(state);
  const label = canRecoverTranscriptEdits(state)
    ? "Edited transcript"
    : undefined;
  const statusLabel = state.paused
    ? "Paused"
    : failedPageCount
      ? pageAttentionText(failedPageCount)
      : attention
      ? label ?? "Needs attention"
      : state.status === "missing"
        ? "Source unavailable"
        : state.status === "excluded"
          ? "Not selected"
          : changed || added
            ? "Updating pages"
            : actionablePending
              ? "Initial import"
              : skippedCount
                ? pagesSkippedText(skippedCount)
              : !total && state.status !== "current"
                ? "Not checked yet"
                : "Up to date";
  const caption = failedPageCount
    ? `${ready} of ${total} pages ready · ${pageAttentionText(failedPageCount)}${skippedCount ? ` · ${pagesSkippedText(skippedCount)}` : ""}`
    : state.paused
    ? `${ready} of ${total} pages ready · ${actionablePending} remaining${skippedCount ? ` · ${pagesSkippedText(skippedCount)}` : ""} · Paused`
    : changed || added
      ? [
          changed
            ? `${changed} edited ${changed === 1 ? "page" : "pages"}`
            : "",
          added ? `${added} new ${added === 1 ? "page" : "pages"}` : "",
          initial ? `${actionablePending} existing pages remaining` : "",
          skippedCount ? pagesSkippedText(skippedCount) : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : actionablePending
        ? `${ready} of ${total} pages ready · ${actionablePending} remaining${skippedCount ? ` · ${pagesSkippedText(skippedCount)}` : ""}`
        : skippedCount
          ? `${ready} of ${total} pages ready · ${pagesSkippedText(skippedCount)}`
        : total
          ? `${total} ${total === 1 ? "page" : "pages"} ready`
          : "Waiting for first check";
  return {
    ready,
    total,
    pending,
    actionablePending,
    changed,
    added,
    initial,
    label: statusLabel,
    caption,
    reason: failedPageCount
      ? pageAttentionText(failedPageCount)
      : reason,
    pageIssues,
    attentionCount: failedPageCount,
    skippedCount,
    ratio: total ? ready / total : 0,
    attention,
  };
}
export function rulePresentation(rule, states) {
  const selected = states.filter((s) => selectedForRule(rule, s));
  const summaries = selected.map(notebookPresentation);
  const sum = (key) => summaries.reduce((n, s) => n + s[key], 0);
  const ready = sum("ready"),
    total = sum("total"),
    pending = sum("pending"),
    changed = sum("changed"),
    added = sum("added"),
    initial = sum("initial");
  const attention = summaries.some((s) => s.attention);
  const affected = selected.filter((s) => attentionReason(s));
  const genericReason = "Open notebook details to review the error.";
  const pageIssueCount = summaries.reduce((n, s) => n + s.attentionCount, 0);
  const skippedCount = summaries.reduce((n, s) => n + s.skippedCount, 0);
  const actionablePending = Math.max(0, pending - skippedCount);
  const reasons = [...new Set(affected.map((s) => attentionReason(s)))];
  const genericAffected = affected.filter((s) => attentionReason(s) === genericReason).length;
  const reason = pageIssueCount
    ? pageAttentionText(pageIssueCount)
    : reasons.length > 1 || (affected.length > 1 && genericAffected > 0)
      ? `${affected.length} notebooks need attention · Expand to see why`
      : reasons[0];
  const missing = selected.some((s) => s.status === "missing");
  const unknown = selected.some(
    (s) => !s.desired.length && s.status !== "current",
  );
  const label = !rule.enabled
    ? "Off"
    : rule.paused || (selected.length > 0 && selected.every((s) => s.paused))
      ? "Paused"
      : pageIssueCount
        ? pageAttentionText(pageIssueCount)
      : attention
        ? "Needs attention"
        : missing
          ? "Source unavailable"
          : changed || added
            ? "Updating pages"
            : actionablePending
              ? "Initial import"
              : skippedCount
                ? pagesSkippedText(skippedCount)
              : !selected.length || unknown
                ? "Not checked yet"
                : "Up to date";
  const caption = !rule.enabled
    ? "Existing transcripts are kept"
    : rule.paused || (selected.length > 0 && selected.every((s) => s.paused))
      ? `${ready} of ${total} pages ready · Remaining notebooks are paused`
      : !selected.length
        ? "Ready to check"
        : `${ready} of ${total} pages ready${actionablePending ? ` · ${actionablePending} remaining` : ""}${skippedCount ? ` · ${pagesSkippedText(skippedCount)}` : ""}`;
  return {
    ready,
    total,
    pending,
    actionablePending,
    changed,
    added,
    initial,
    label,
    caption,
    reason,
    ratio: total ? ready / total : 0,
    attention,
    attentionCount: pageIssueCount,
    skippedCount,
  };
}
export function overviewPresentation(controller) {
  const { config, store, progress, autoEnabled } = controller;
  const enabled = config.rules.filter((r) => r.enabled);
  const states = Object.values(store.notebooks).filter((s) =>
    enabled.some((r) => selectedForRule(r, s)),
  );
  const summaries = states.map(notebookPresentation);
  const sum = (key) => summaries.reduce((n, s) => n + s[key], 0);
  const ready = sum("ready"),
    total = sum("total"),
    pending = sum("pending"),
    changed = sum("changed"),
    added = sum("added");
  const unknown = states.some(
    (s) => !s.desired.length && s.status !== "current",
  );
  const missing = states.some((s) => s.status === "missing");
  const pageIssueCount = summaries.reduce((n, s) => n + s.attentionCount, 0);
  const skippedCount = summaries.reduce((n, s) => n + s.skippedCount, 0);
  const actionablePending = Math.max(0, pending - skippedCount);
  const attention =
    summaries.some((s) => s.attention) || progress.stage === "Needs attention";
  const page = progress.activePage;
  let label, caption;
  if (progress.stateBlocked) {
    label = "Saved state unavailable";
    caption = "Restore the plugin state backup, then reload Obsidian. Updates cannot repair saved-state storage.";
  } else if (progress.budgetBlocked) {
    label = controller.provider === "subscription" ? "Usage limit reached" : "Spending paused";
    caption = progress.budgetBlocked;
  } else if (progress.paused) {
    label = progress.running ? "Pausing" : "Paused";
    caption = progress.running
      ? "Finishing the current page"
      : "Your saved pages are available";
  } else if (!enabled.length) {
    label = "Choose what to mirror";
    caption = "Add a notebook or folder to begin";
  } else if (pageIssueCount) {
    label = pageAttentionText(pageIssueCount);
    caption = "Other pages continue; open the mirror to retry or skip affected pages";
  } else if (skippedCount && !actionablePending) {
    label = pagesSkippedText(skippedCount);
    caption = `${ready} pages ready · ${pagesSkippedText(skippedCount)}`;
  } else if (progress.executionBlocked) {
    label = "Recognition paused";
    caption = progress.executionBlocked;
  } else if (attention) {
    label = "Needs attention";
    caption = "Open the affected mirror to resolve it";
  } else if (missing) {
    label = "Source unavailable";
    caption = "Previous transcripts are kept in the archive";
  } else if (changed || added) {
    label = "Updating pages";
    caption = `${changed + added} new or edited pages${pending > changed + added ? ` · ${pending - changed - added} existing pages remaining` : ""}`;
  } else if (actionablePending) {
    label = "Initial import";
    caption = `${ready} of ${total} pages ready · ${actionablePending} remaining${skippedCount ? ` · ${pagesSkippedText(skippedCount)}` : ""}`;
  } else if (progress.running || unknown || !states.length) {
    label = "Checking for changes";
    caption = "Saved pages are kept";
  } else {
    label = "Up to date";
    caption = "All selected pages are ready";
  }
  if (
    !progress.stateBlocked &&
    !progress.budgetBlocked &&
    !progress.executionBlocked &&
    !progress.paused &&
    progress.running &&
    progress.stage === "Waiting for AI"
  )
    label = "Waiting for AI";
  if (!progress.stateBlocked && !progress.budgetBlocked && !progress.executionBlocked && !progress.paused && page && progress.running)
    caption = `Recognizing page ${page.number} of ${page.total} · ${ready} pages ready`;
  else if (
    actionablePending &&
    !progress.running &&
    !progress.paused &&
    !progress.stateBlocked &&
    !progress.budgetBlocked &&
    !progress.executionBlocked &&
    !attention
  ) {
    const pausedWork =
      states.some((s) => s.paused) || enabled.some((r) => r.paused);
    if (pausedWork) caption += " · Some work is paused";
    else
      caption += autoEnabled
        ? " · Continues while Obsidian is open"
        : " · Tap Update to continue";
  }
  if (controller.aiEnabled === false && !progress.running && !progress.stateBlocked) {
    label = "AI recognition off";
    caption = total
      ? `${ready} of ${total} pages ready${skippedCount ? ` · ${pagesSkippedText(skippedCount)}` : ""} · No AI requests`
      : "Checks only · No AI requests";
  }
  return {
    label,
    caption,
    ready,
    total,
    pending,
    changed,
    added,
    ratio: total ? ready / total : 0,
    attention,
    attentionCount: pageIssueCount,
    skippedCount,
  };
}
