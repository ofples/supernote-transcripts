(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (p.task) await p.task;
  const state = Object.values(p.store.notebooks)[0];
  return {
    validation: window.__autoValidation,
    auto: p.autoEnabled,
    hidden: document.hidden,
    progress: p.progress,
    ready: state.desired.filter(
      (x) => state.pages[x.id]?.fingerprint === x.fingerprint,
    ).length,
    total: state.desired.length,
    source: state.source,
    output: state.output,
  };
})();
