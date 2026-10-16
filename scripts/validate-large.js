(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const reader = p.reader(),
    path = "/storage/emulated/0/Note/Reflections/2509 - Reflection.note";
  const start = Date.now(),
    opened = await reader.open(path);
  try {
    const indexed = Date.now() - start;
    const image = await opened.render(1);
    const result = {
      bytes: (await app.vault.adapter.fs.stat(path)).size,
      pages: opened.descriptor.pages.length,
      indexMs: indexed,
      indexAndRenderMs: Date.now() - start,
      pngDataUrlCharacters: image.length,
      width: opened.descriptor.width,
      height: opened.descriptor.height,
    };
    p.stage(
      "Batch saved",
      "Saved results are ready. Automatic catch-up continues while Obsidian is active.",
    );
    return result;
  } finally {
    opened.close();
  }
})();
