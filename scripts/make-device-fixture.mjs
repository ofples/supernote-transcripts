import { open, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { SupernoteX, toImage, flattenToWhite } from "supernote-typescript";
import { encodeDataURL } from "image-js";
const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument)
  throw Error(
    "Usage: node scripts/make-device-fixture.mjs source.note output-folder",
  );
const source = resolve(sourceArgument),
  output = resolve(outputArgument),
  size = (await stat(source)).size;
const handle = await open(source, "r");
const layerNames = ["MAINLAYER", "LAYER1", "LAYER2", "LAYER3", "BGLAYER"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function read(offset, length) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > size
  )
    throw Error("Invalid source extent");
  const b = Buffer.alloc(length);
  const { bytesRead } = await handle.read(b, 0, length, offset);
  if (bytesRead !== length) throw Error("Source read ended early");
  return b;
}
async function block(address) {
  address = Number(address || 0);
  if (address === 0) return null;
  const length = (await read(address, 4)).readUInt32LE();
  if (length > 64 * 1024 * 1024)
    throw Error("Source individual block exceeds fixture guard");
  return read(address + 4, length);
}
function pairs(bytes) {
  const result = {};
  for (const match of bytes.toString("utf8").matchAll(/<([^:<>]+):([^:<>]+)>/g))
    result[match[1]] = match[2];
  return result;
}
function encode(record) {
  return Buffer.from(
    Object.entries(record)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `<${k}:${v}>`)
      .join(""),
  );
}
try {
  const signature = await read(0, 24);
  if (!/^(?:mark|note)SN_FILE_VER_\d{8}/.test(signature.toString()))
    throw Error("Unsupported source signature");
  const footer = pairs(await block((await read(size - 4, 4)).readUInt32LE()));
  const header = pairs(await block(footer.FILE_FEATURE || 24));
  const addresses = Object.keys(footer)
    .filter((k) => /^PAGE\d+$/.test(k))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .slice(0, 4)
    .map((k) => footer[k]);
  if (addresses.length < 4) throw Error("Source must have at least four pages");
  const sourcePages = [];
  for (const address of addresses) {
    const meta = pairs(await block(address));
    const sequence = (meta.LAYERSEQ || "MAINLAYER,BGLAYER").split(",");
    if (sequence.some((n) => !layerNames.includes(n)))
      throw Error("Unknown source layer sequence");
    const layers = {};
    for (const name of layerNames) {
      const data = await block(meta[name]);
      if (data) {
        const layer = pairs(data);
        layers[name] = { meta: layer, bitmap: await block(layer.LAYERBITMAP) };
      }
    }
    sourcePages.push({ meta, layers });
  }
  let width = header.APPLY_EQUIPMENT === "N5" ? 1920 : 1404,
    height = header.APPLY_EQUIPMENT === "N5" ? 2560 : 1872;
  if (sourcePages.every((p) => ["1090", "1270"].includes(p.meta.ORIENTATION)))
    [width, height] = [height, width];
  const sourceRenderHashes = [];
  for (const original of sourcePages) {
    const page = {
      PAGESTYLE: original.meta.PAGESTYLE || "0",
      LAYERSEQ: (original.meta.LAYERSEQ || "MAINLAYER,BGLAYER").split(","),
    };
    for (const name of layerNames) {
      const layer = original.layers[name];
      page[name] = {
        LAYERNAME: layer?.meta.LAYERNAME || name,
        bitmapBuffer: layer?.bitmap || null,
      };
    }
    const [image] = await toImage(
      { pageWidth: width, pageHeight: height, pages: [page] },
      [1],
    );
    sourceRenderHashes.push(hash(encodeDataURL(flattenToWhite(image))));
  }
  const identities = ["test-one", "test-two", "test-three"];
  const variants = {
    base: [
      { id: identities[0], sourcePage: 1 },
      { id: identities[1], sourcePage: 2 },
    ],
    reordered: [
      { id: identities[1], sourcePage: 2 },
      { id: identities[0], sourcePage: 1 },
      { id: identities[2], sourcePage: 3 },
    ],
    edited: [
      { id: identities[1], sourcePage: 2 },
      { id: identities[0], sourcePage: 4 },
      { id: identities[2], sourcePage: 3 },
    ],
    deleted: [
      { id: identities[0], sourcePage: 4 },
      { id: identities[2], sourcePage: 3 },
    ],
  };
  const manifest = {
    source,
    sourceBytes: size,
    equipment: header.APPLY_EQUIPMENT,
    sourceRenderHashes,
    dimensions: { width, height },
    identities: Object.fromEntries(
      identities.map((id) => [id, `native:${id}`]),
    ),
    variants: {},
    expectedTransitions: {
      baseToReordered: {
        reuse: ["native:test-one", "native:test-two"],
        new: ["native:test-three"],
      },
      reorderedToEdited: {
        reuse: ["native:test-two", "native:test-three"],
        edited: ["native:test-one"],
      },
      editedToDeleted: {
        reuse: ["native:test-one", "native:test-three"],
        deleted: ["native:test-two"],
      },
    },
  };
  await mkdir(output, { recursive: true });
  for (const [name, pages] of Object.entries(variants)) {
    const chunks = [signature];
    let offset = 24;
    const append = (bytes) => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(bytes.length);
      const address = offset;
      chunks.push(length, bytes);
      offset += 4 + bytes.length;
      return address;
    };
    const headerAddress = append(
      encode({
        ...header,
        FINAL_OPERATION_PAGE: "1",
        FINAL_OPERATION_LAYER: "MAINLAYER",
      }),
    );
    const pageAddresses = [];
    for (const { id, sourcePage } of pages) {
      const original = sourcePages[sourcePage - 1];
      const page = {
        PAGESTYLE: original.meta.PAGESTYLE || "0",
        PAGESTYLEMD5: original.meta.PAGESTYLEMD5 || "0",
        ORIENTATION: original.meta.ORIENTATION || "0",
        PAGEID: id,
        LAYERSEQ: original.meta.LAYERSEQ || "MAINLAYER,BGLAYER",
        LAYERINFO: original.meta.LAYERINFO || "[]",
        RECOGNSTATUS: "0",
        RECOGNTEXT: "0",
        RECOGNFILE: "0",
        RECOGNFILESTATUS: "0",
        TOTALPATH: "0",
      };
      for (const layerName of layerNames) {
        const originalLayer = original.layers[layerName];
        if (!originalLayer) {
          page[layerName] = "0";
          continue;
        }
        const bitmapAddress = originalLayer.bitmap?.length
          ? append(originalLayer.bitmap)
          : 0;
        page[layerName] = String(
          append(
            encode({
              LAYERTYPE: originalLayer.meta.LAYERTYPE || "NOTE",
              LAYERPROTOCOL: originalLayer.meta.LAYERPROTOCOL || "RATTA_RLE",
              LAYERNAME: originalLayer.meta.LAYERNAME || layerName,
              LAYERBITMAP: String(bitmapAddress),
              LAYERPATH: "0",
              LAYERVECTORGRAPH: "0",
              LAYERRECOGN: "0",
            }),
          ),
        );
      }
      pageAddresses.push(append(encode(page)));
    }
    const footerAddress = append(
      encode({
        FILE_FEATURE: String(headerAddress),
        ...Object.fromEntries(
          pageAddresses.map((a, i) => [`PAGE${i + 1}`, String(a)]),
        ),
      }),
    );
    const end = Buffer.alloc(4);
    end.writeUInt32LE(footerAddress);
    chunks.push(end);
    const bytes = Buffer.concat(chunks);
    const filename = join(output, `${name}.note`);
    if (filename === source)
      throw Error("Fixture destination would overwrite the original");
    const note = new SupernoteX(bytes);
    const renderHashes = [];
    for (let page = 1; page <= note.pages.length; page++) {
      const [image] = await toImage(note, [page]);
      renderHashes.push(hash(encodeDataURL(flattenToWhite(image))));
    }
    for (let i = 0; i < pages.length; i++)
      if (renderHashes[i] !== sourceRenderHashes[pages[i].sourcePage - 1])
        throw Error("Fixture rendering differs from original source page");
    await writeFile(filename, bytes);
    manifest.variants[name] = {
      file: `${name}.note`,
      bytes: bytes.length,
      pages: pages.map((p, i) => ({
        ...p,
        number: i + 1,
        nativeId: `native:${p.id}`,
        renderHash: renderHashes[i],
      })),
    };
  }
  const v = manifest.variants;
  if (
    v.base.pages[0].renderHash !== v.reordered.pages[1].renderHash ||
    v.base.pages[1].renderHash !== v.reordered.pages[0].renderHash
  )
    throw Error("Reordered fixture failed visual identity validation");
  if (v.edited.pages[1].renderHash === v.reordered.pages[1].renderHash)
    throw Error(
      "Fourth source page is visually identical to page one; choose another source",
    );
  if (v.edited.pages[1].renderHash !== v.deleted.pages[0].renderHash)
    throw Error("Deleted fixture lost edited page identity");
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      output,
      variants: Object.fromEntries(
        Object.entries(manifest.variants).map(([name, v]) => [
          name,
          { bytes: v.bytes, pages: v.pages.length },
        ]),
      ),
      renderValidation: "passed",
    }),
  );
} finally {
  await handle.close();
}
