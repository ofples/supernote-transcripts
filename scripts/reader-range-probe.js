(async () => {
  const fs = app.vault.adapter.fs,
    p = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  const st = await fs.stat(p);
  const r = await fetch(fs.getUri(p), { headers: { Range: "bytes=0-23" } });
  const bytes = await r.arrayBuffer();
  return {
    stat: st,
    uri: fs.getUri(p),
    status: r.status,
    headers: [...r.headers],
    length: bytes.byteLength,
    head: new TextDecoder().decode(bytes.slice(0, 24)),
  };
})();
