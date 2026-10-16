(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const fixture = app.plugins.plugins["nomad-transcripts-ui-fixture"];
  const ownForms = [...document.querySelectorAll(
    ".st-fullscreen-modal, .st-preview-modal",
  )].length;
  const states = Object.values(p?.store?.notebooks ?? {});
  return {
    version: p?.manifest?.version ?? null,
    loaded: !!p,
    initializing: !!p?.initializing,
    taskIdle: !!p && !p.task,
    paused: p?.progress?.paused === true,
    stateBlocked: !!p?.stateStorageIssue || !!p?.progress?.stateBlocked,
    connected: !!p?.subscriptionStatus?.connected,
    fixtureLoaded: !!fixture,
    ownForms,
    notebookCount: states.length,
    statuses: states.reduce((acc, state) => {
      acc[state.status] = (acc[state.status] ?? 0) + 1;
      return acc;
    }, {}),
  };
})()
