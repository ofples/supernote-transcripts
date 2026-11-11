import test from "node:test";
import assert from "node:assert/strict";
import { createActivityLog, activityStatus } from "../src/activity-model.mjs";

const progress = (overrides = {}) => ({ stage: "Ready", detail: "PRIVATE NOTE TEXT and prompt", running: false, paused: false, ...overrides });
const notebook = (source, ready, total, status = "current") => ({
  source, status, desired: Array.from({ length: total }, (_, i) => ({ id: `p${i}`, number: i + 1, fingerprint: `f${i}` })),
  pages: Object.fromEntries(Array.from({ length: ready }, (_, i) => [`p${i}`, { fingerprint: `f${i}`, text: "PRIVATE TRANSCRIPT" }])),
});

test("one live entry updates to a notebook summary and completes from saved page state", () => {
  const log = createActivityLog();
  let current = log.update(progress({ running: true, activeSource: "C:/private/Notebook.note", stage: "Rendering", detail: "secret" }), { notebooks: { n: notebook("C:/private/Notebook.note", 1, 3) } }, 1000);
  assert.equal(current.status, "Updating · Notebook.note · 1/3 pages");
  assert.equal(current.ready, 1);
  assert.equal(current.total, 3);
  log.update(progress({ running: true, activeSource: "C:/private/Notebook.note", stage: "Recognizing", activePage: { number: 2, total: 3 } }), { notebooks: { n: notebook("C:/private/Notebook.note", 2, 3) } }, 5000);
  assert.equal(log.entries.length, 0, "page stages do not append log rows");
  log.update(progress(), { notebooks: { n: notebook("C:/private/Notebook.note", 3, 3) } }, 9000);
  assert.equal(log.entries.length, 1);
  assert.deepEqual({ source: log.entries[0].source, ready: log.entries[0].ready, total: log.entries[0].total, elapsedMs: log.entries[0].elapsedMs, outcome: log.entries[0].outcome }, {
    source: "Notebook.note", ready: 3, total: 3, elapsedMs: 8000, outcome: "completed",
  });
  assert.doesNotMatch(log.copyText(), /PRIVATE|secret|Rendering|Recognizing|private\//);
});

test("paused and failed runs have sanitized actionable reasons", () => {
  const log = createActivityLog();
  const store = { notebooks: { n: notebook("/vault/Paused.note", 1, 4) } };
  log.update(progress({ running: true, activeSource: "/vault/Paused.note" }), store, 100);
  log.update(progress({ paused: true }), store, 2100);
  assert.equal(log.entries[0].outcome, "paused");
  assert.match(log.entries[0].reason, /Paused by user/);
  const failedStore = { notebooks: { n: { ...notebook("/vault/Failed.note", 1, 2, "failed"), error: "PRIVATE raw API response" } } };
  log.update(progress({ running: true, activeSource: "/vault/Failed.note" }), failedStore, 3000);
  log.update(progress({ executionBlocked: "PRIVATE provider response" }), failedStore, 4000);
  assert.equal(log.entries[1].outcome, "failed");
  assert.match(log.entries[1].reason, /provider or connection/);
  assert.doesNotMatch(log.copyText(), /PRIVATE|raw API response/);
});

test("activity ring is bounded and status stays compact", () => {
  const log = createActivityLog(2);
  for (let i = 0; i < 3; i++) {
    const source = `/vault/Book${i}.note`;
    const store = { notebooks: { [`n${i}`]: notebook(source, 1, 1) } };
    log.update(progress({ running: true, activeSource: source }), store, i * 1000 + 1);
    log.update(progress(), store, i * 1000 + 2);
  }
  assert.equal(log.entries.length, 2);
  assert.match(log.copyText(), /Book2\.note · 1\/1 pages/);
  assert.equal(activityStatus(progress({ paused: true, running: true })), "Paused");
  assert.equal(activityStatus(progress({ running: true, stage: "Recognizing" })), "Updating");
  assert.equal(activityStatus(progress()), "Idle");
});

test("status projects checking and updating counts, current and idle outcomes", () => {
  const log = createActivityLog();
  const store = { notebooks: { n: notebook("/vault/Book.note", 1, 3) } };
  const checking = log.update(progress({ running: true, activeSource: "/vault/Book.note", stage: "Checking notebook pages", checked: 2, total: 5 }), store, 1000);
  assert.equal(checking.phase, "Checking");
  assert.match(checking.status, /2\/5 notebooks/);
  const updating = log.update(progress({ running: true, activeSource: "/vault/Book.note", stage: "Recognizing", activePage: { source: "/vault/Book.note", number: 2, total: 3 } }), store, 2000);
  assert.equal(updating.phase, "Updating");
  assert.match(updating.status, /1\/3 pages/);
  assert.equal(activityStatus(progress(), { notebooks: { n: notebook("/vault/Book.note", 3, 3) } }), "Current");
  assert.equal(activityStatus(progress()), "Idle");
});

test("an update failure or waiting work is visible even when saved transcripts are current", () => {
  const store = { notebooks: { n: notebook("/vault/Book.note", 3, 3) } };
  assert.equal(activityStatus(progress({ stage: "Needs attention" }), store), "Needs attention");
  assert.equal(activityStatus(progress(), { ...store, queue: [{ source: "/vault/Pending.note" }] }), "Waiting");
});

test("durable source and page issues remain actionable after restart without raw details", () => {
  const store = { notebooks: { n: {
    ...notebook("C:/private/Book.note", 1, 3, "failed"),
    error: "PRIVATE raw provider response at C:/private/secret",
    executionIssue: { scope: "source", reason: "PRIVATE raw provider response" },
    pageIssues: { p1: { fingerprint: "f1", status: "failed", reason: "SECRET response" } },
  } } };
  // A fresh log models a restart: issues come from the canonical saved store, not the volatile log.
  const restarted = createActivityLog();
  const state = restarted.update(progress(), store, 1000);
  assert.equal(state.phase, "Needs attention");
  assert.equal(state.issues.length, 2);
  assert.equal(state.issues[0].label, "Book.note · Page 2");
  assert.equal(state.issues[0].pageId, "p1");
  assert.match(state.issues[0].nextAction, /Retry this page/);
  assert.equal(state.issues[1].label, "Book.note");
  assert.match(state.issues[1].nextAction, /Check this source/);
  assert.doesNotMatch(JSON.stringify(state.issues) + restarted.copyText(), /PRIVATE|SECRET|C:\\private|raw provider/);
});

test("manual active work remains Updating while global pause is on", () => {
  const state = createActivityLog().update(progress({ running: true, paused: true, activeSource: "/vault/manual.note", manualSources: ["/vault/manual.note"], activePage: { source: "/vault/manual.note", number: 1, total: 1 } }), {}, 10);
  assert.equal(state.phase, "Updating");
  assert.match(state.status, /^Updating/);
});

test("manual inventory work without an active source stays visible during global pause", () => {
  const progressState = progress({ running: true, paused: true, manualSources: ["/vault/manual.note"], stage: "Checking notebooks", checked: 2, total: 4 });
  assert.equal(activityStatus(progressState), "Checking");
  const checking = createActivityLog().update(progressState, {}, 100);
  assert.equal(checking.phase, "Checking");
  assert.equal(checking.outcome, "running");
  assert.match(checking.status, /2\/4 notebooks/);
  const updating = createActivityLog().update({ ...progressState, stage: "Recognizing pages", recognized: 1 }, {}, 100);
  assert.equal(updating.phase, "Updating");
  assert.match(updating.status, /Updating · 1\/4 pages/);
});

test("paused status includes unresolved issue count and uncertain delivery avoids a blind retry", () => {
  const store = { notebooks: { n: {
    ...notebook("/private/Book.note", 0, 2),
    pageIssues: {
      p0: { fingerprint: "f0", status: "failed", kind: "interrupted", reason: "SECRET raw detail", attempts: 1 },
      p1: { fingerprint: "f1", status: "failed", kind: "provider", reason: "PRIVATE provider text", attempts: 1 },
    },
  } } };
  const log = createActivityLog();
  const state = log.update(progress({ paused: true }), store, 100);
  assert.equal(state.status, "Paused · 2 issues");
  assert.match(state.issues[0].nextAction, /before deciding whether to retry or skip/);
  assert.doesNotMatch(state.issues[0].nextAction, /blind|automatically retry/i);
  assert.doesNotMatch(log.copyText(), /SECRET|PRIVATE|Book\.note|\/private/);
});

test("durable source issues surface without notebook states and sanitize unsafe guidance", () => {
  const store = { notebooks: {}, sourceIssues: {
    "rule-safe": { source: "C:/private/Books", reason: "Source could not be found. Check whether it moved, then choose Update.", observedAt: "2026-11-09T00:00:00.000Z" },
    "rule-unsafe": { source: "/secret/path/Archive", reason: "C:/secret API payload token=PRIVATE", observedAt: "2026-11-09T00:00:00.000Z" },
  } };
  const log = createActivityLog();
  const state = log.update(progress(), store, 100);
  assert.equal(state.phase, "Needs attention");
  assert.equal(state.issues.length, 2);
  assert.deepEqual(state.issues.map(issue => issue.ruleId), ["rule-safe", "rule-unsafe"]);
  assert.deepEqual(state.issues.map(issue => issue.label), ["Books", "Archive"]);
  assert.equal(state.issues[0].nextAction, "Source could not be found. Check whether it moved, then choose Update.");
  assert.equal(state.issues[1].nextAction, "Check the source location and permissions, then choose Update.");
  assert.equal(activityStatus(progress({ paused: true }), store), "Paused");
  const paused = log.update(progress({ paused: true }), store, 200);
  assert.equal(paused.status, "Paused · 2 issues");
  assert.doesNotMatch(log.copyText(), /C:\\private|secret|PRIVATE|payload|Books|Archive/);
});
