import { AndroidReadOnlySource } from "../src/reader";
(globalThis as any).readerDiagnostic = async () => {
  const source = new AndroidReadOnlySource(
    (globalThis as any).app.vault.adapter.fs,
  );
  const list = await source.list("/storage/emulated/0/Note", true, []);
  return {
    count: list.length,
    largest: [...list].sort((a, b) => b.size - a.size).slice(0, 4),
  };
};
(globalThis as any).readerOpen = async (path: string, render = false) => {
  const start = Date.now();
  const source = new AndroidReadOnlySource(
    (globalThis as any).app.vault.adapter.fs,
  );
  const note = await source.open(path);
  const d = note.descriptor;
  const out: any = {
    path,
    pages: d.pages.length,
    width: d.width,
    height: d.height,
    first: d.pages.slice(0, 2),
    milliseconds: Date.now() - start,
  };
  if (render) {
    const image = await note.render(1);
    out.pngLength = image.length;
    out.renderMilliseconds = Date.now() - start;
  }
  note.close();
  return out;
};
