(async () => {
  const id = "nomad-transcripts";
  if (!window.__fixtureConfig) {
    await app.plugins.unloadPlugin(id);
    await app.plugins.loadPlugin(id);
  }
  const p = app.plugins.plugins[id];
  if (!window.__fixtureConfig)
    window.__fixtureConfig = JSON.parse(JSON.stringify(p.config));
  const path =
    "/storage/emulated/0/Note/.nomad-transcripts-validation/fixture.note";
  p.config.rules = [
    {
      id: "isolated-validation",
      enabled: true,
      source: "/storage/emulated/0/Note/.nomad-transcripts-validation",
      output: "Experiments/Nomad transcripts validation",
      recursive: true,
      exclude: [],
      profileId: "general",
    },
  ];
  p.config.batchPages = 2;
  let calls = [];
  const original = p.transcribe;
  p.transcribe = async (image, page) => {
    calls.push(page);
    return `TEST FIXTURE: recognized page ${page} in pass ${window.__fixturePass ?? 0}; NOT ACTUAL NOTE TEXT.`;
  };
  window.__fixturePass = (window.__fixturePass ?? 0) + 1;
  let error;
  try {
    await p.update();
  } catch (e) {
    error = e.message;
  } finally {
    p.transcribe = original;
  }
  const state = p.store.notebooks[path];
  return {
    pass: window.__fixturePass,
    calls,
    error,
    progress: p.progress,
    state: state
      ? {
          status: state.status,
          order: state.order,
          pages: Object.fromEntries(
            Object.entries(state.pages).map(([id, v]) => [
              id,
              { number: v.number, text: v.text },
            ]),
          ),
          output: state.output,
        }
      : null,
    history: p.store.history.length,
    markdown:
      state && (await app.vault.adapter.exists(state.output))
        ? await app.vault.adapter.read(state.output)
        : null,
  };
})();
