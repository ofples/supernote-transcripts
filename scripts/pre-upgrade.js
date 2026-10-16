(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  return {
    vault: app.vault.getName(),
    configDir: app.vault.configDir,
    loaded: !!p,
    busy: !!p?.busy,
    keyConfigured: !!p?.apiKey,
    settings: {
      source: p?.config.source,
      output: p?.config.output,
      model: p?.config.model,
    },
    cachedPages: Object.fromEntries(
      Object.entries(p?.cache ?? {}).map(([path, pages]) => [
        path,
        Object.keys(pages),
      ]),
    ),
    source: await app.vault.adapter.fs.stat(
      "/storage/emulated/0/Note/Reflections/2610 - Reflection.note",
    ),
  };
})();
