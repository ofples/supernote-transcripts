import { open } from "node:fs/promises";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { toImage, flattenToWhite } from "supernote-typescript";
import { encodeDataURL } from "image-js";
await build({
  entryPoints: ["src/reader.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "test-artifacts/reader-visibility-audit-module.mjs",
});
const { indexNotebook } =
  await import("../test-artifacts/reader-visibility-audit-module.mjs");
const h = await open(
  process.argv[2] || "test-artifacts/fixture-source.note",
  "r",
);
const size = (await h.stat()).size;
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function read(a, l) {
  const b = Buffer.alloc(l);
  await h.read(b, 0, l, a);
  return b;
}
async function block(a) {
  a = Number(a);
  return a ? read(a + 4, (await read(a, 4)).readUInt32LE()) : null;
}
const pairs = (b) =>
  Object.fromEntries(
    [...b.toString().matchAll(/<([^:<>]+):([^<>]*)>/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
try {
  const tail = await read(size - 4, 4),
    footerAddress = tail.readUInt32LE();
  const footer = pairs(await block(footerAddress));
  const select = Object.fromEntries(
    Object.entries(footer).filter(
      ([key]) => key === "FILE_FEATURE" || /^PAGE[1-4]$/.test(key),
    ),
  );
  const selectedFooter = Buffer.from(
    Object.entries(select)
      .map(([k, v]) => `<${k}:${v}>`)
      .join(""),
  );
  const source = {
    size,
    head: () => read(0, 24),
    tail: () => Promise.resolve(new Uint8Array(tail)),
    scan: async (addresses, consume) => {
      for (const a of [...new Set(addresses)].filter(Boolean))
        await consume(a, a === footerAddress ? selectedFooter : await block(a));
    },
  };
  const indexed = await indexNotebook(source);
  const results = [];
  for (let i = 0; i < 4; i++) {
    const page = indexed.pages[i],
      original = pairs(await block(select[`PAGE${i + 1}`]));
    const declared = original.LAYERSEQ.split(",");
    const renderPage = {
      PAGESTYLE: original.PAGESTYLE || "0",
      LAYERSEQ: declared,
    };
    const fingerprintLayers = [];
    for (const name of declared) {
      const meta = pairs(await block(original[name]));
      const bitmap = await block(meta.LAYERBITMAP);
      const layerName = meta.LAYERNAME || name;
      renderPage[name] = { LAYERNAME: layerName, bitmapBuffer: bitmap };
      fingerprintLayers.push([name, layerName, bitmap ? hash(bitmap) : null]);
    }
    const oldFingerprint = hash(
      JSON.stringify({
        renderer: "snt-0.7.1-native-1",
        width: indexed.width,
        height: indexed.height,
        style: original.PAGESTYLE || "0",
        layers: fingerprintLayers,
      }),
    );
    const visiblePage = { ...renderPage, LAYERSEQ: page.sequence };
    const oldImage = encodeDataURL(
      flattenToWhite(
        (
          await toImage(
            {
              pageWidth: indexed.width,
              pageHeight: indexed.height,
              pages: [renderPage],
            },
            [1],
          )
        )[0],
      ),
    );
    const newImage = encodeDataURL(
      flattenToWhite(
        (
          await toImage(
            {
              pageWidth: indexed.width,
              pageHeight: indexed.height,
              pages: [visiblePage],
            },
            [1],
          )
        )[0],
      ),
    );
    results.push({
      page: i + 1,
      declared,
      visible: page.sequence,
      fingerprintChanged: oldFingerprint !== page.fingerprint,
      renderChanged: hash(oldImage) !== hash(newImage),
      oldFingerprint,
      newFingerprint: page.fingerprint,
    });
  }
  console.log(JSON.stringify(results));
} finally {
  await h.close();
}
