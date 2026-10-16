(() => {
  const id = "nomad-transcripts";
  const p = app.plugins.plugins[id];
  const forms = [...document.querySelectorAll(".st-fullscreen-modal, .st-preview-modal")];
  return {
    app: app.vault.getName(),
    version: p?.manifest?.version ?? null,
    loaded: !!p,
    initializing: !!p?.initializing,
    taskIdle: !!p && !p.task && !p.progress?.running,
    paused: p?.progress?.paused === true,
    stateBlocked: !!p?.stateStorageIssue || !!p?.progress?.stateBlocked,
    connected: !!p?.subscriptionStatus?.connected,
    fixtureLoaded: !!app.plugins.plugins["nomad-transcripts-ui-fixture"],
    forms: forms.map((form) => ({
      className: form.className,
      ariaLabel: form.getAttribute("aria-label"),
      text: (form.innerText ?? "").slice(0, 160),
    })),
    callsThisRun: p?.callsThisRun ?? null,
    notebookCount: Object.keys(p?.store?.notebooks ?? {}).length,
    notebookStatuses: Object.values(p?.store?.notebooks ?? {}).reduce((acc, state) => {
      acc[state.status] = (acc[state.status] ?? 0) + 1;
      return acc;
    }, {}),
  };
})()
