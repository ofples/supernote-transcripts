(async () => {
  const id = "nomad-transcripts";
  localStorage.setItem(
    `nomad-transcripts:${app.vault.getName()}:auto`,
    "false",
  );
  await app.plugins.unloadPlugin(id);
  await app.plugins.loadPlugin(id);
  const p = app.plugins.plugins[id],
    path = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  let calls = 0;
  const original = p.transcribe;
  p.transcribe = async () => {
    calls++;
    throw Error("Unexpected paid request in final cache check");
  };
  let error;
  try {
    await p.manual(path, "1-4");
  } catch (e) {
    error = e.message;
  } finally {
    p.transcribe = original;
  }
  if (error) throw Error(error);
  p.autoEnabled = true;
  delete window.__autoOriginal;
  delete window.__autoOff;
  delete window.__autoValidation;
  app.commands.executeCommandById("nomad-transcripts:open");
  const state = p.store.notebooks[path];
  return {
    version: p.manifest.version,
    keyConfigured: !!p.apiKey,
    auto: p.autoEnabled,
    batch: p.config.batchPages,
    interval: p.config.intervalMinutes,
    paused: p.progress.paused,
    calls,
    ready: state.desired.filter(
      (page) => state.pages[page.id]?.fingerprint === page.fingerprint,
    ).length,
    total: state.desired.length,
    status: state.status,
    progress: p.progress,
    sourceMetadata: await app.vault.adapter.fs.stat(path),
    rules: p.config.rules.map((rule) => ({
      source: rule.source,
      enabled: rule.enabled,
    })),
    panelOpen: !!document.querySelector(".st-modal"),
  };
})();
