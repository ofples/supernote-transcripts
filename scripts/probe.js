(async () => {
  const fs = app.vault.adapter.fs;
  const path = "/storage/emulated/0/Note/Reflections/2610 - Reflection.note";
  return {
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(fs)),
    stat: await fs.stat(path),
    list: await fs.readdir("/storage/emulated/0/Note/Reflections"),
    bytes: (await fs.readBinary(path)).byteLength,
  };
})();
