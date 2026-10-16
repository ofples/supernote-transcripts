(() => {
  const id = "nomad-transcripts";
  const p = app.plugins.plugins[id];
  const basename = (path) => String(path ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const safeError = (value) => String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/[A-Z]:\\[^\s]+/g, "[path]")
    .replace(/\/storage\/[^\s]+/g, "[path]")
    .replace(/[^\s]+\.md/gi, "[file]")
    .slice(0, 240);
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const forms = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]));
  const ownForms = [...forms].filter((node) => node.matches(".st-fullscreen-modal,.st-preview-modal") || node.querySelector(".st-fullscreen-modal,.st-preview-modal")).length;
  const prefix = `nomad-transcripts:${app.vault.getName()}`;
  const usageRaw = localStorage.getItem(`${prefix}:subscription-usage-v1`);
  let usage = { readable: false, requests: 0, byStatus: {}, today: 0, satsangByStatus: {} };
  try {
    const entries = usageRaw === null ? [] : JSON.parse(usageRaw);
    if (Array.isArray(entries)) {
      const day = new Date().toISOString().slice(0, 10);
      const tally = (rows) => rows.reduce((result, entry) => { result[entry.status] = (result[entry.status] ?? 0) + 1; return result; }, {});
      usage = {
        readable: true,
        requests: entries.length,
        byStatus: tally(entries),
        today: entries.filter((entry) => entry.day === day).length,
        satsangByStatus: tally(entries.filter((entry) => /Satsang/i.test(basename(entry.source)))),
      };
    }
  } catch {}
  const rules = p?.config?.rules ?? [];
  const satsangRule = rules.find((rule) => /Satsang/i.test(basename(rule.source)) || /Satsang/i.test(rule.source));
  const profile = satsangRule && p?.config?.profiles?.find((candidate) => candidate.id === satsangRule.profileId);
  const states = Object.values(p?.store?.notebooks ?? {}).filter((state) =>
    (satsangRule && state.ruleId === satsangRule.id) || /Satsang/i.test(basename(state.source)));
  const notebookStates = states.map((state) => ({
    sourceName: basename(state.source),
    outputName: basename(state.output),
    ruleId: state.ruleId,
    status: state.status,
    paused: !!state.paused,
    desiredPages: state.desired?.length ?? 0,
    cachedPageRecords: Object.keys(state.pages ?? {}).length,
    publishedPages: state.publishedPages?.length ?? 0,
    pageErrorPresent: !!state.error,
    pageError: safeError(state.error),
  }));
  const satsangUsageRaw = usageRaw;
  const satsangRequestStats = (() => {
    try {
      const entries = satsangUsageRaw === null ? [] : JSON.parse(satsangUsageRaw);
      if (!Array.isArray(entries)) return { total: 0, byStatus: {}, byModel: {} };
      const rows = entries.filter((entry) => /Satsang/i.test(basename(entry.source)));
      const tally = (values) => values.reduce((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
      return { total: rows.length, byStatus: tally(rows.map((entry) => entry.status)), byModel: tally(rows.map((entry) => entry.model)) };
    } catch { return { total: 0, byStatus: {}, byModel: {} }; }
  })();
  const status = {
    version: p?.manifest?.version ?? null,
    platform: p?.platform ?? null,
    connected: !!p?.subscriptionStatus?.connected,
    idle: !!p && !p.task,
    taskRunning: !!p?.task,
    progressPaused: !!p?.progress?.paused,
    globalPausePreference: localStorage.getItem(`${prefix}:paused`) === "true",
    autoEnabled: !!p?.autoEnabled,
    aiEnabled: !!p?.aiEnabled,
    provider: p?.provider ?? null,
    concurrency: p?.concurrency ?? null,
    localWorkers: localStorage.getItem(`${prefix}:workers`),
    progressStage: p?.progress?.stage ?? null,
    activePage: p?.progress?.activePage ? {
      sourceName: basename(p.progress.activePage.source),
      number: p.progress.activePage.number,
      total: p.progress.activePage.total,
    } : null,
    queueWorking: p?.queueView?.working ? {
      sourceName: basename(p.queueView.working.source),
      number: p.queueView.working.number ?? null,
      total: p.queueView.working.total ?? null,
      stage: p.queueView.working.stage,
    } : null,
    ownForms,
    otherForms: forms.size - ownForms,
    satsangRule: satsangRule ? {
      id: satsangRule.id,
      profileId: satsangRule.profileId,
      sourceName: basename(satsangRule.source),
      outputName: basename(satsangRule.output),
      paused: !!satsangRule.paused,
      enabled: satsangRule.enabled !== false,
    } : null,
    satsangProfile: profile ? {
      id: profile.id,
      name: profile.name,
      model: profile.model,
      promptLength: profile.prompt?.length ?? 0,
      glossaries: Array.isArray(profile.glossaries) ? profile.glossaries : [],
    } : null,
    notebookStates,
    subscriptionUsage: usage,
    satsangRequestStats,
    recognitionRequestsThisRun: p?.callsThisRun ?? 0,
  };
  globalThis.__pageErrorsReadonlyPreflight = status;
  return status;
})()
