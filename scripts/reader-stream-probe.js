(async () => {
  const fs = app.vault.adapter.fs,
    p = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  const r = await fetch(fs.getUri(p));
  let count = 0,
    max = 0,
    last;
  const reader = r.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.length;
    max = Math.max(max, value.length);
    last = value.slice(-4);
  }
  return { count, max, last: [...last], stream: !!r.body };
})();
