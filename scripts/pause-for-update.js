(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  p.pause();
  if (p.task) await p.task;
  const state = Object.values(p.store.notebooks)[0];
  return {
    paused: p.progress.paused,
    ready: state.desired.filter(
      (page) => state.pages[page.id]?.fingerprint === page.fingerprint,
    ).length,
    total: state.desired.length,
  };
})();
