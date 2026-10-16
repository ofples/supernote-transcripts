(() => {
  const fs = require("fs");
  const backup = JSON.parse(fs.readFileSync(
    "C:/Users/pless/Code/Supernote/nomad-transcripts/test-artifacts/backup-before-0.7.1-desktop/state-b.json",
    "utf8",
  ));
  const p = app.plugins.plugins["nomad-transcripts"];
  const before = backup.store, after = p.store;
  const summarize = (store) => Object.values(store.notebooks).map((state) => ({
    name: String(state.source).replace(/\\/g, "/").split("/").pop(),
    status: state.status,
    errorPresent: typeof state.error === "string",
    desired: state.desired.length,
    cached: Object.keys(state.pages ?? {}).length,
    issues: Object.keys(state.pageIssues ?? {}).length,
    legacyHold: typeof state.legacyPageFailure === "string",
    queueEntries: store.queue.filter((entry) => entry.source === state.source).length,
    pagesUnchanged: JSON.stringify(state.pages) === JSON.stringify(after.notebooks[state.source]?.pages),
    desiredUnchanged: JSON.stringify(state.desired) === JSON.stringify(after.notebooks[state.source]?.desired),
  }));
  const changed = [];
  for (const [source, old] of Object.entries(before.notebooks)) {
    const current = after.notebooks[source];
    if (!current) { changed.push({ name: source.split("/").pop(), missing: true }); continue; }
    const keys = [...new Set([...Object.keys(old), ...Object.keys(current)])];
    const fields = keys.filter((key) => JSON.stringify(old[key]) !== JSON.stringify(current[key]));
    if (fields.length) changed.push({ name: source.replace(/\\/g, "/").split("/").pop(), fields });
  }
  const oldQueue = before.queue ?? [], newQueue = after.queue ?? [];
  const removed = oldQueue.filter((old) => !newQueue.some((next) => JSON.stringify(old) === JSON.stringify(next)));
  const added = newQueue.filter((next) => !oldQueue.some((old) => JSON.stringify(old) === JSON.stringify(next)));
  const result = {
    version: p.manifest.version,
    paused: p.progress.paused,
    idle: !p.task && !p.progress.running,
    stateBlocked: !!p.stateStorageIssue || !!p.progress.stateBlocked,
    notebooks: summarize(after),
    changedStateFields: changed,
    oldQueueCount: oldQueue.length,
    newQueueCount: newQueue.length,
    removedQueueCount: removed.length,
    addedQueueCount: added.length,
    removedQueueNotebookBasenames: removed.map((entry) => entry.source.replace(/\\/g, "/").split("/").pop()),
    addedQueueNotebookBasenames: added.map((entry) => entry.source.replace(/\\/g, "/").split("/").pop()),
  };
  globalThis.__desktop071MigrationDiagnosis = result;
  return result;
})()
