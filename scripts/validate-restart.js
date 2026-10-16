(async () => {
  const id = "nomad-transcripts";
  await app.plugins.unloadPlugin(id);
  await app.plugins.loadPlugin(id);
  const p = app.plugins.plugins[id],
    path = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  let calls = 0;
  const original = p.transcribe;
  p.transcribe = async () => {
    calls++;
    throw Error("Unexpected charged request after restart");
  };
  let error;
  try {
    await p.manual(path, "2");
  } catch (e) {
    error = e.message;
  } finally {
    p.transcribe = original;
  }
  const state = p.store.notebooks[path];
  return {
    version: p.manifest.version,
    keyConfigured: !!p.apiKey,
    calls,
    error,
    progress: p.progress,
    ready: state.desired.filter(
      (x) => state.pages[x.id]?.fingerprint === x.fingerprint,
    ).length,
    total: state.desired.length,
    journal:
      (await app.vault.adapter.exists(
        `${app.vault.configDir}/plugins/${id}/state-a.json`,
      )) &&
      (await app.vault.adapter.exists(
        `${app.vault.configDir}/plugins/${id}/state-b.json`,
      )),
  };
})();
