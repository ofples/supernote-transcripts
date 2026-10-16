(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  return await p.run("2610 - Reflection.note", "1", false, () => {});
})();
