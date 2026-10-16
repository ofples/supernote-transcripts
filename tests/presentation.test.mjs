import test from "node:test";
import assert from "node:assert/strict";
import {
  AsyncActionGate,
  canRecoverTranscriptEdits,
  currentPageIssues,
  notebookPresentation,
  rulePresentation,
  overviewPresentation,
  rollbackConfigEntry,
} from "../src/presentation.mjs";
const state = () => ({
  ruleId: "r",
  status: "queued",
  desired: [1, 2, 3].map((n) => ({
    id: String(n),
    number: n,
    fingerprint: `f${n}`,
  })),
  pages: { 1: { fingerprint: "f1", text: "saved" } },
  forcePending: [],
  priorityPages: [],
});
test("UI async action gate rejects duplicate work and releases after failure", async () => {
  const gate = new AsyncActionGate();
  let calls = 0;
  let release;
  const first = gate.run("same-page", async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
  });
  assert.ok(first);
  assert.equal(gate.run("same-page", async () => { calls++; }), undefined);
  const independent = gate.run("other-page", async () => { calls++; });
  await independent;
  await Promise.resolve();
  assert.equal(calls, 2);
  release();
  await first;
  await assert.rejects(gate.run("same-page", async () => { throw Error("save failed"); }), /save failed/);
  assert.equal(await gate.run("same-page", async () => "retry"), "retry");
});
test("config save rollback restores only its own entry and preserves concurrent edits", () => {
  const oldRule = { id: "folder", source: "/old", exclude: [] };
  const attemptedRule = { id: "folder", source: "/new", exclude: [] };
  const otherRule = { id: "other", source: "/other", exclude: [] };
  const rules = [attemptedRule, otherRule];
  assert.equal(rollbackConfigEntry(rules, "folder", attemptedRule, oldRule, 0), true);
  assert.deepEqual(rules, [oldRule, otherRule]);

  const concurrentRule = { id: "folder", source: "/concurrent", exclude: [] };
  rules[0] = concurrentRule;
  assert.equal(rollbackConfigEntry(rules, "folder", attemptedRule, oldRule, 0), false);
  assert.equal(rules[0], concurrentRule);

  const added = { id: "added", source: "/added", exclude: [] };
  const withAdded = [added, otherRule];
  assert.equal(rollbackConfigEntry(withAdded, "added", added, undefined), true);
  assert.deepEqual(withAdded, [otherRule]);
  assert.equal(rollbackConfigEntry(withAdded, "removed", undefined, oldRule, 0), true);
  assert.deepEqual(withAdded, [oldRule, otherRule]);
});
test("saving exclusions removes notebook progress immediately without altering cached state", () => {
  const s = { ...state(), source: "/Note/Satsang/old.note" };
  const r = { id: "r", enabled: true, source: "/Note/Satsang", exclude: [] };
  const c = {
    config: { rules: [r] },
    store: { notebooks: { s } },
    progress: {},
    autoEnabled: false,
  };
  assert.equal(rulePresentation(r, [s]).total, 3);
  r.exclude = ["old.note"];
  assert.equal(rulePresentation(r, [s]).total, 0);
  assert.equal(overviewPresentation(c).total, 0);
  assert.equal(s.status, "queued");
  assert.equal(s.pages[1].text, "saved");
});
test("a backfill notebook is shown as pages remaining, not repeated recognition", () => {
  const p = notebookPresentation(state());
  assert.equal(p.label, "Initial import");
  assert.equal(p.ready, 1);
  assert.equal(p.pending, 2);
  assert.equal(p.ratio, 1 / 3);
});
test("edited/new pages remain distinct from unfinished initial import", () => {
  const s = state();
  s.pages["1"].fingerprint = "old";
  s.priorityPages = ["3"];
  const p = notebookPresentation(s);
  assert.equal(p.changed, 1);
  assert.equal(p.added, 1);
  assert.equal(p.initial, 1);
  assert.equal(p.label, "Updating pages");
});
test("recipe changes alone do not imply pages need recognition", () => {
  const s = state();
  s.pages = Object.fromEntries(
    s.desired.map((p) => [p.id, { fingerprint: p.fingerprint }]),
  );
  s.profileOutdated = true;
  s.status = "current";
  assert.equal(notebookPresentation(s).label, "Up to date");
});
test("disabled sources do not contaminate overall progress", () => {
  const s = state();
  const r = { id: "r", enabled: false };
  const c = {
    config: { rules: [r] },
    store: { notebooks: { s }, queue: [{ source: "s" }] },
    progress: { running: false, paused: false },
    autoEnabled: true,
  };
  assert.equal(rulePresentation(r, [s]).label, "Off");
  assert.equal(overviewPresentation(c).total, 0);
  assert.equal(overviewPresentation(c).label, "Choose what to mirror");
});
test("pause, attention and active page have readable stable labels", () => {
  const s = state();
  const c = {
    config: { rules: [{ id: "r", enabled: true }] },
    store: { notebooks: { s } },
    progress: {
      running: true,
      paused: false,
      activePage: { number: 2, total: 3 },
    },
    autoEnabled: true,
  };
  assert.match(overviewPresentation(c).caption, /Recognizing page 2 of 3/);
  c.progress.paused = true;
  assert.equal(overviewPresentation(c).label, "Pausing");
  c.progress.running = false;
  assert.equal(overviewPresentation(c).label, "Paused");
  c.progress.paused = false;
  s.status = "failed";
  assert.equal(overviewPresentation(c).label, "Needs attention");
});
test("force requests do not appear falsely complete; unknown totals are not up to date", () => {
  const s = state();
  s.forcePending = ["1"];
  assert.equal(notebookPresentation(s).ready, 0);
  s.desired = [];
  s.pages = {};
  assert.equal(notebookPresentation(s).label, "Not checked yet");
});
test("source pauses stay visible without asking for another global update", () => {
  const s = state();
  s.paused = true;
  assert.equal(notebookPresentation(s).label, "Paused");
  const rule = { id: "r", enabled: true, paused: true };
  assert.equal(rulePresentation(rule, [s]).label, "Paused");
  const c = {
    config: { rules: [rule] },
    store: { notebooks: { s } },
    progress: { running: false, paused: false },
    autoEnabled: false,
  };
  assert.match(overviewPresentation(c).caption, /Some work is paused/);
  assert.doesNotMatch(overviewPresentation(c).caption, /Tap Update/);
});
test("spending guard has a distinct overview status and caption", () => {
  const s = state();
  const c = {
    config: { rules: [{ id: "r", enabled: true }] },
    store: { notebooks: { s } },
    progress: {
      running: false,
      paused: false,
      budgetBlocked: "Daily limit reached",
    },
    autoEnabled: true,
  };
  assert.equal(overviewPresentation(c).label, "Spending paused");
  assert.equal(overviewPresentation(c).caption, "Daily limit reached");
  s.status = "failed";
  assert.equal(overviewPresentation(c).label, "Spending paused");
  c.aiEnabled = false;
  assert.equal(overviewPresentation(c).label, "AI recognition off");
});
test("attention reasons give specific actions for known errors and keep unknowns honest", () => {
  const failed = {
    ...state(),
    status: "failed",
    error: "Older desktop Cloud snapshot rejected against the current source.",
  };
  assert.equal(
    notebookPresentation(failed).reason,
    "Refresh the Supernote Cloud source.",
  );
  failed.error = "Shared transcript results have not arrived yet.";
  assert.equal(
    notebookPresentation(failed).reason,
    "Wait for Obsidian Sync, then retry.",
  );
  failed.error = "Shared transcript has a newer or conflicting page inventory. Wait for source synchronization before retrying.";
  assert.equal(
    notebookPresentation(failed).reason,
    "Sync the original notebook to this device, then choose Update or Resume on Sources.",
  );
  failed.error = "Unexpected provider response: 502";
  assert.equal(
    notebookPresentation(failed).reason,
    "Open notebook details to review the error.",
  );
  assert.equal(notebookPresentation(failed).attention, true);
  failed.error = 'Cannot read glossary "Glossaries/terms.txt". Restore it in this vault.';
  assert.equal(notebookPresentation(failed).reason,
    "Restore or reselect the glossary in mirror settings.");
});
test("only manual transcript ownership conflicts offer cached edit recovery", () => {
  const s = {
    ...state(),
    status: "conflict",
    error: "Generated transcript was manually edited.",
  };
  assert.equal(canRecoverTranscriptEdits(s), true);
  assert.equal(notebookPresentation(s).label, "Edited transcript");
  s.error = "Shared transcript results have not arrived yet.";
  assert.equal(canRecoverTranscriptEdits(s), false);
  s.error = "Publication receipt conflict; wait for synchronization.";
  assert.equal(canRecoverTranscriptEdits(s), false);
  s.status = "missing";
  s.error = "Generated transcript was manually edited.";
  assert.equal(canRecoverTranscriptEdits(s), false);
});
test("missing sources and folder attention summaries explain what needs action", () => {
  const missing = {
    ...state(),
    source: "/vault/Reflection.note",
    status: "missing",
    error: "Not found in the completed scan.",
  };
  assert.equal(
    notebookPresentation(missing).reason,
    "Check the source path and confirm the notebook is available.",
  );
  const rule = {
    id: "r",
    enabled: true,
    source: "/vault",
    exclude: [],
  };
  const conflict = {
    ...state(),
    source: "/vault/Satsang.note",
    status: "conflict",
    error: "Manually edited transcript conflict.",
  };
  assert.equal(rulePresentation(rule, [missing]).reason,
    "Check the source path and confirm the notebook is available.");
  assert.equal(rulePresentation(rule, [missing, conflict]).reason,
    "2 notebooks need attention · Expand to see why");
  missing.status = "failed";
  missing.error = "Unexpected provider response: 502";
  conflict.error = "Unexpected provider response: 503";
  assert.equal(rulePresentation(rule, [missing, conflict]).reason,
    "2 notebooks need attention · Expand to see why");
});
test("page issues are current-fingerprint scoped and summarized without raw provider text", () => {
  const s = state();
  s.status = "partial";
  s.pageIssues = {
    "2": {
      fingerprint: "f2",
      number: 2,
      status: "failed",
      kind: "incomplete",
      reason: "Response did not finish (max_output_tokens).",
      attempts: 1,
      updatedAt: "2026-10-14T00:00:00.000Z",
    },
    "3": {
      fingerprint: "old-fingerprint",
      number: 3,
      status: "failed",
      kind: "empty_response",
      reason: "A stale issue must not be shown.",
      attempts: 1,
      updatedAt: "2026-10-14T00:00:00.000Z",
    },
  };
  const issues = currentPageIssues(s);
  assert.deepEqual(issues.map((issue) => issue.id), ["2"]);
  const view = notebookPresentation(s);
  assert.equal(view.attentionCount, 1);
  assert.equal(view.label, "1 page needs attention");
  assert.equal(view.reason, "1 page needs attention");
  assert.match(view.caption, /1 page needs attention/);
  const rule = { id: "r", enabled: true, source: "/vault", exclude: [] };
  assert.equal(rulePresentation(rule, [s]).reason, "1 page needs attention");
});
test("page issue retry targets follow the descriptor's current number after reorder", () => {
  const s = state();
  s.desired = [
    { id: "2", number: 1, fingerprint: "f2" },
    { id: "1", number: 2, fingerprint: "f1" },
  ];
  s.pageIssues = {
    "2": {
      fingerprint: "f2",
      number: 2,
      status: "skipped",
      kind: "incomplete",
      reason: "Skipped",
      attempts: 1,
      updatedAt: "2026-10-14T00:00:00.000Z",
    },
  };
  assert.deepEqual(currentPageIssues(s).map(({ id, number, status }) => ({ id, number, status })), [
    { id: "2", number: 1, status: "skipped" },
  ]);
});
test("skipped pages stay visible without being counted as errors", () => {
  const s = {
    ...state(),
    status: "partial",
    pageIssues: {
      "2": {
        fingerprint: "f2",
        number: 2,
        status: "skipped",
        kind: "incomplete",
        reason: "User skipped this page.",
        attempts: 1,
        updatedAt: "2026-10-14T00:00:00.000Z",
      },
      "3": {
        fingerprint: "f3",
        number: 3,
        status: "skipped",
        kind: "incomplete",
        reason: "User skipped this page.",
        attempts: 1,
        updatedAt: "2026-10-14T00:00:00.000Z",
      },
    },
  };
  const notebook = notebookPresentation(s);
  assert.equal(notebook.label, "2 pages skipped");
  assert.equal(notebook.attention, false);
  assert.equal(notebook.attentionCount, 0);
  assert.equal(notebook.skippedCount, 2);
  assert.equal(notebook.pageIssues[0].status, "skipped");

  const rule = { id: "r", enabled: true, source: "/vault", exclude: [] };
  const folder = rulePresentation(rule, [s]);
  assert.equal(folder.label, "2 pages skipped");
  assert.equal(folder.attention, false);
  assert.match(folder.caption, /2 pages skipped/);
});
test("folder summaries distinguish failed pages from intentionally skipped pages", () => {
  const s = {
    ...state(),
    status: "partial",
    pageIssues: {
      "2": {
        fingerprint: "f2",
        number: 2,
        status: "failed",
        kind: "empty_response",
        reason: "No response.",
        attempts: 1,
        updatedAt: "2026-10-14T00:00:00.000Z",
      },
      "3": {
        fingerprint: "f3",
        number: 3,
        status: "skipped",
        kind: "incomplete",
        reason: "User skipped this page.",
        attempts: 1,
        updatedAt: "2026-10-14T00:00:00.000Z",
      },
    },
  };
  const notebook = notebookPresentation(s);
  assert.equal(notebook.label, "1 page needs attention");
  assert.match(notebook.caption, /1 page needs attention · 1 page skipped/);
  assert.equal(notebook.attention, true);

  const rule = { id: "r", enabled: true, source: "/vault", exclude: [] };
  const folder = rulePresentation(rule, [s]);
  assert.equal(folder.label, "1 page needs attention");
  assert.equal(folder.attention, true);
  assert.equal(folder.attentionCount, 1);
  assert.equal(folder.skippedCount, 1);
  assert.match(folder.caption, /1 page skipped/);
});
test("fatal account and model stops are labeled as recognition pauses, not spending", () => {
  const c = {
    config: { rules: [{ id: "r", enabled: true }] },
    store: { notebooks: {} },
    progress: { running: false, paused: false, executionBlocked: "Reconnect the provider account." },
    autoEnabled: true,
  };
  const view = overviewPresentation(c);
  assert.equal(view.label, "Recognition paused");
  assert.equal(view.caption, "Reconnect the provider account.");
});
test("saved-state storage block takes priority and names backup restoration", () => {
  const c = {
    config: { rules: [{ id: "r", enabled: true }] },
    store: { notebooks: {} },
    progress: {
      running: false,
      paused: true,
      stateBlocked: "Notebook state could not be saved.",
    },
    aiEnabled: false,
    autoEnabled: true,
  };
  const view = overviewPresentation(c);
  assert.equal(view.label, "Saved state unavailable");
  assert.match(view.caption, /Restore the plugin state backup, then reload Obsidian/);
  assert.match(view.caption, /Updates cannot repair saved-state storage/);
});
test("blocked queued work never advertises Update as a way to continue", () => {
  const s = { ...state(), source: "/Note/Queued.note" };
  const c = {
    config: { rules: [{ id: "r", enabled: true, source: "/Note", exclude: [] }] },
    store: { notebooks: { [s.source]: s } },
    progress: { running: false, paused: false, stateBlocked: "State is unreadable." },
    autoEnabled: false,
  };
  const view = overviewPresentation(c);
  assert.equal(view.label, "Saved state unavailable");
  assert.doesNotMatch(view.caption, /Tap Update to continue/);

  c.progress.stateBlocked = undefined;
  c.progress.executionBlocked = "Provider settings need attention.";
  const executionView = overviewPresentation(c);
  assert.equal(executionView.label, "Recognition paused");
  assert.doesNotMatch(executionView.caption, /Tap Update to continue/);
});
test("source-held config issues give a concise repair action without exposing diagnostic text", () => {
  const s = {
    ...state(),
    status: "partial",
    executionIssue: {
      scope: "source",
      reason: "A detailed sanitized failure should stay in notebook diagnostics.",
    },
  };
  const view = notebookPresentation(s);
  assert.equal(view.label, "Needs attention");
  assert.equal(view.reason, "Check this source, then retry the notebook.");
  assert.doesNotMatch(view.reason, /detailed sanitized failure/);
});
test("source content revision changes ask for a notebook save instead of source settings", () => {
  const s = {
    ...state(),
    status: "partial",
    executionIssue: {
      scope: "source",
      reason: "Notebook content changed while pages were being processed. Save it in Notes and retry this notebook.",
    },
  };
  const view = notebookPresentation(s);
  assert.equal(view.reason, "Save the notebook, then retry this notebook.");
  assert.equal(view.attention, true);
});
