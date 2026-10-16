(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const result = globalThis.__nomad071ActivationResult ?? null;
  return {
    result,
    loadedVersion: p?.manifest?.version ?? null,
    loaded: !!p,
    initializing: !!p?.initializing,
    idle: !!p && !p.task,
    paused: p?.progress?.paused === true,
    blocked: !!p?.stateStorageIssue || !!p?.progress?.stateBlocked,
    connected: !!p?.subscriptionStatus?.connected,
    modalCount: document.querySelectorAll(".st-fullscreen-modal, .st-preview-modal").length,
  };
})()
