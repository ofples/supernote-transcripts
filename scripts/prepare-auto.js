(async () => {
  const id = "nomad-transcripts";
  await app.plugins.unloadPlugin(id);
  await app.plugins.loadPlugin(id);
  const p = app.plugins.plugins[id];
  p.config.batchPages = 2;
  p.config.intervalMinutes = 5;
  await p.saveConfig();
  window.__autoValidation = { calls: [], stages: [] };
  const original = p.transcribe;
  p.transcribe = async (...args) => {
    window.__autoValidation.calls.push(args[1]);
    return original.apply(p, args);
  };
  window.__autoOff = p.subscribe(() => {
    const s = p.progress.stage;
    if (window.__autoValidation.stages.at(-1) !== s)
      window.__autoValidation.stages.push(s);
  });
  window.__autoOriginal = original;
  p.autoEnabled = true;
  return {
    auto: p.autoEnabled,
    paused: p.progress.paused,
    batch: p.config.batchPages,
    interval: p.config.intervalMinutes,
    version: p.manifest.version,
  };
})();
