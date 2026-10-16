(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (window.__autoOriginal) p.transcribe = window.__autoOriginal;
  window.__autoOff?.();
  delete window.__autoOriginal;
  delete window.__autoOff;
  delete window.__autoValidation;
  app.commands.executeCommandById("nomad-transcripts:open");
  return {
    auto: p.autoEnabled,
    progress: p.progress,
    version: p.manifest.version,
  };
})();
