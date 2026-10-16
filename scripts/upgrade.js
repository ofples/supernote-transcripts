(async () => {
  const id = "nomad-transcripts";
  localStorage.setItem(
    `nomad-transcripts:${app.vault.getName()}:auto`,
    "false",
  );
  await app.plugins.unloadPlugin(id);
  await app.plugins.loadManifests();
  await app.plugins.loadPlugin(id);
  const p = app.plugins.plugins[id];
  return {
    loaded: !!p,
    version: p?.manifest.version,
    keyConfigured: !!p?.apiKey,
    auto: p?.autoEnabled,
    rules: p?.config.rules,
    profiles: p?.config.profiles.map((x) => ({
      id: x.id,
      model: x.model,
      glossaries: x.glossaries,
    })),
    cached: Object.values(p?.store.notebooks ?? {}).map((x) => ({
      source: x.source,
      legacy: x.legacy,
      pages: Object.keys(x.pages).length,
    })),
  };
})();
