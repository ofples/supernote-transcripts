(async () => {
  const id = "nomad-transcripts";
  await app.plugins.loadManifests();
  await app.plugins.enablePluginAndSave(id);
  const p = app.plugins.plugins[id];
  return {
    loaded: !!p,
    name: p?.manifest.name,
    config: p
      ? {
          source: p.config.source,
          output: p.config.output,
          model: p.config.model,
        }
      : null,
  };
})();
