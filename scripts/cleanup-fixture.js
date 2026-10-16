(async () => {
  const p = app.plugins.plugins["nomad-transcripts"],
    key = "/storage/emulated/0/Note/.nomad-transcripts-validation/fixture.note",
    state = p.store.notebooks[key];
  if (!state || state.source !== key)
    throw Error("Fixture ownership not verified");
  const history = p.store.history.filter((path) =>
    path.startsWith(`Supernote Transcripts/History/${state.id.slice(0, 12)}/`),
  );
  const files = [state.output, ...history];
  const snapshots = [];
  for (const path of files) {
    if (await app.vault.adapter.exists(path)) {
      const text = await app.vault.adapter.read(path);
      if (!text.includes("TEST FIXTURE:"))
        throw Error("Unexpected non-fixture content; cleanup stopped");
      snapshots.push({ path, text });
      await app.vault.adapter.remove(path);
    }
  }
  p.store.history = p.store.history.filter((path) => !history.includes(path));
  return { removed: files, snapshots };
})();
