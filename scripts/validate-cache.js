(async () => {
  const p = app.plugins.plugins["nomad-transcripts"],
    path = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  p.config.rules[0].source = path;
  p.config.rules.push({
    id: "reflections-tree",
    enabled: false,
    source: "/storage/emulated/0/Note/Reflections",
    output: "Experiments/Nomad transcripts",
    recursive: true,
    exclude: [],
    profileId: "reflections",
  });
  p.config.batchPages = 1;
  await p.saveConfig();
  let calls = 0;
  const original = p.transcribe;
  p.transcribe = async () => {
    calls++;
    throw new Error("Validation blocked an unexpected paid request");
  };
  const start = Date.now();
  let error;
  try {
    await p.manual(path, "1");
  } catch (e) {
    error = e.message;
  } finally {
    p.transcribe = original;
  }
  const state = p.store.notebooks[path];
  return {
    durationMs: Date.now() - start,
    calls,
    error,
    progress: p.progress,
    state: {
      status: state.status,
      pages: Object.keys(state.pages).length,
      desired: state.desired.length,
      legacy: state.legacy,
      profileOutdated: state.profileOutdated,
    },
    source: await app.vault.adapter.fs.stat(path),
  };
})();
