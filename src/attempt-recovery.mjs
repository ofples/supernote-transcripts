// Reconcile durable request accounting with durable text after interruption.
// This does not request recognition, mark text successful, or alter money totals.
export function interruptedAttempts(entries, notebooks) {
  const latest = new Map(), legacy = new Map();
  for (const entry of entries) {
    const state = notebooks[entry.source];
    if (!state) continue;
    // The existing notebook action already resolves these attempts explicitly.
    if (state.executionIssue || state.legacyPageFailure) continue;
    if (!entry.pageId || !entry.fingerprint || !entry.recipe) {
      if (!entry.acknowledged && ["pending", "reserved", "unconfirmed"].includes(entry.status)) {
        const rows = legacy.get(entry.source) ?? []; rows.push(entry); legacy.set(entry.source, rows);
      }
      continue;
    }
    const key = JSON.stringify([entry.source, entry.pageId, entry.fingerprint]);
    const previous = latest.get(key);
    if (!previous || entry.started >= previous.started) latest.set(key, entry);
  }
  const pages = [];
  for (const entry of latest.values()) {
    if (entry.acknowledged) continue;
    const state = notebooks[entry.source];
    const page = state.desired.find(p => p.id === entry.pageId);
    if (!page || page.fingerprint !== entry.fingerprint) continue;
    if (state.pageIssues?.[page.id]?.fingerprint === page.fingerprint) continue;
    const result = state.pages[page.id];
    if (!state.forcePending?.includes(page.id) && result?.fingerprint === page.fingerprint && result.recipe === entry.recipe && typeof result.text === "string" && result.text.trim()) continue;
    pages.push({ source:entry.source, pageId:page.id, fingerprint:page.fingerprint, number:page.number, recipe:entry.recipe, force:state.forcePending?.includes(page.id)===true,
      kind:entry.status === "complete" ? "lost_result" : "interrupted", requestId:entry.id,
      reason:entry.status === "complete" ? "A request completed, but its saved text could not be recovered. Retry this page explicitly or skip it; no automatic repeat request was sent." : "A previous request has no saved result for this page. Retry it explicitly or skip it; its attempt remains counted." });
  }
  return { pages, legacy:[...legacy].map(([source,rows])=>({source,requestIds:rows.map(r=>r.id),reason:"An interrupted request from an earlier version cannot be matched reliably to a page. Retry this notebook explicitly to continue; saved pages will be reused."})) };
}
