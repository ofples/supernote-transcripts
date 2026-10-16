(async () => {
  const messages = [];
  const original = console.error;
  console.error = (...args) => {
    messages.push(
      args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "),
    );
    original(...args);
  };
  try {
    await app.plugins.loadManifests();
    const result = await app.plugins.loadPlugin("nomad-transcripts");
    return {
      manifest: app.plugins.manifests["nomad-transcripts"],
      result,
      loaded: !!app.plugins.plugins["nomad-transcripts"],
      messages,
    };
  } finally {
    console.error = original;
  }
})();
