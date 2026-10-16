(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  p.config = window.__fixtureConfig;
  await p.saveConfig();
  for (const [key, state] of Object.entries(p.store.notebooks)) {
    if (key.includes("/.nomad-transcripts-validation/"))
      delete p.store.notebooks[key];
  }
  p.store.queue = p.store.queue.filter(
    (q) => !q.source.includes("/.nomad-transcripts-validation/"),
  );
  await p.persist();
  delete window.__fixtureConfig;
  delete window.__fixturePass;
  return { rules: p.config.rules, queue: p.store.queue, auto: p.autoEnabled };
})();
