(async () => {
  const p = app.plugins.plugins["nomad-transcripts"];
  const file = "2610 - Reflection.note";
  const before = await p.fs().stat(`${p.root()}/${file}`);
  const started = Date.now();
  const { note } = await p.openNote(file);
  const image = await p.render(note, 1);
  const data = await (await fetch(image)).arrayBuffer();
  const path = "Experiments/Nomad transcripts/Prototype preview.png";
  await p.ensureFolder(path);
  await app.vault.adapter.writeBinary(path, data);
  const after = await p.fs().stat(`${p.root()}/${file}`);
  return {
    file,
    pages: note.pages.length,
    width: note.pageWidth,
    height: note.pageHeight,
    pngBytes: data.byteLength,
    elapsedMs: Date.now() - started,
    sourceUnchanged: before.mtime === after.mtime && before.size === after.size,
    previewPath: path,
  };
})();
