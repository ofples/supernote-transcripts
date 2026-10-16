(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const docs = [globalThis.document, globalThis.activeDocument, globalThis.activeDocument?.containerEl, globalThis.activeDocument?.contentEl]
    .filter((doc, i, all) => doc?.querySelectorAll && all.indexOf(doc) === i);
  const forms = new Set(docs.flatMap((doc) => [...doc.querySelectorAll(".modal-container,[role='dialog'],.st-fullscreen-modal,.st-preview-modal")]));
  const result = {
    vault: app.vault.getName(), configDir: app.vault.configDir,
    loaded: !!p, version: p?.manifest?.version ?? null, platform: p?.platform ?? null,
    initializing: !!p?.initializing, idle: !!p && !p.task && !p.progress.running,
    paused: !!p?.progress.paused,
    pausedPreference: localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:paused`) === "true",
    stateBlocked: !!p?.stateStorageIssue || !!p?.progress.stateBlocked,
    connected: !!p?.subscriptionStatus?.connected,
    forms: forms.size,
    fixtureLoaded: !!app.plugins.plugins["nomad-transcripts-ui-fixture"],
  };
  globalThis.__desktop010Preflight = result;
  return result;
})();
