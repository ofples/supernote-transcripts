(async () => {
  const p = app.plugins.plugins["nomad-transcripts"],
    path = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  const stages = [],
    off = p.subscribe(() => {
      const stage = p.progress.stage;
      if (stages.at(-1) !== stage) stages.push(stage);
    });
  let calls = 0;
  const original = p.transcribe;
  p.transcribe = async (...args) => {
    calls++;
    return original.apply(p, args);
  };
  const start = Date.now();
  let error;
  try {
    await p.manual(path, "2");
  } catch (e) {
    error = e.message;
  } finally {
    p.transcribe = original;
    off();
  }
  const state = p.store.notebooks[path];
  const page = state.desired.find((x) => x.number === 2);
  return {
    durationMs: Date.now() - start,
    calls,
    error,
    stages,
    progress: p.progress,
    state: {
      status: state.status,
      ready: state.desired.filter(
        (x) => state.pages[x.id]?.fingerprint === x.fingerprint,
      ).length,
      total: state.desired.length,
      page2Characters: state.pages[page.id]?.text.length,
      output: state.output,
    },
    source: await app.vault.adapter.fs.stat(path),
  };
})();
