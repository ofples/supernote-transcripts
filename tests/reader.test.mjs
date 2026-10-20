import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/reader.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { indexNotebook, openByteNotebook, previewByteNotebook, AndroidReadOnlySource } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const support = await build({
  entryPoints: ["src/reader-support/stream.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { StreamingFile, identities } = await import(
  "data:text/javascript;base64," +
    Buffer.from(support.outputFiles[0].text).toString("base64")
);
function notebook({
  ids = ["one", "two"],
  ink = ["a", "b"],
  order = [0, 1],
  status = "0",
  last = "1",
  style = "0",
  layerInfo,
  footerKeys,
  recognition,
  recognitionAddress = "",
  fileId,
} = {}) {
  const signature = new Uint8Array(24);
  signature.set(new TextEncoder().encode("noteSN_FILE_VER_20260016"));
  const chunks = [signature];
  const addresses = { pages: [] };
  let offset = 24;
  const block = (s) => {
    const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
    const out = new Uint8Array(b.length + 4);
    new DataView(out.buffer).setUint32(0, b.length, true);
    out.set(b, 4);
    const a = offset;
    offset += out.length;
    chunks.push(out);
    return a;
  };
  const h = block(`<APPLY_EQUIPMENT:N6><FINAL_OPERATION_PAGE:${last}>${fileId === undefined ? "" : `<FILE_ID:${fileId}>`}`);
  addresses.header = h;
  const pages = ids.map((id, i) => {
    const bitmap = block(ink[i]);
    const layer = block(`<LAYERNAME:MAINLAYER><LAYERBITMAP:${bitmap}>`);
    const recogn = recognition === undefined ? 0 : block(new TextEncoder().encode(btoa(JSON.stringify(recognition))));
    const page = block(
      `<PAGEID:${id}><MAINLAYER:${layer}><LAYERSEQ:MAINLAYER><PAGESTYLE:${style}><RECOGNSTATUS:${status}>${recogn ? `<RECOGNTEXT:${recogn}>` : recognitionAddress ? `<RECOGNTEXT:${recognitionAddress}>` : ""}${layerInfo === undefined ? "" : `<LAYERINFO:${layerInfo}>`}`,
    );
    addresses.pages.push({ page, layer, bitmap });
    return page;
  });
  const f = block(
    `<FILE_FEATURE:${h}>` +
      order
        .map((p, i) => `<${footerKeys?.[i] || `PAGE${i + 1}`}:${pages[p]}>`)
        .join(""),
  );
  addresses.footer = f;
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, f, true);
  chunks.push(tail);
  const data = new Uint8Array(offset + 4);
  let p = 0;
  for (const b of chunks) {
    data.set(b, p);
    p += b.length;
  }
  data.blockAddresses = addresses;
  return data;
}
function uniformRle(color) {
  const pixels = 1404 * 1872;
  const fullRuns = Math.floor(pixels / 16384);
  const remainder = pixels % 16384;
  const encoded = new Uint8Array(fullRuns * 2 + (remainder ? 4 : 0));
  for (let i = 0; i < fullRuns; i++) {
    encoded[i * 2] = color;
    encoded[i * 2 + 1] = 0xff;
  }
  if (remainder) {
    const priorLength = Math.floor(remainder / 128);
    const tailLength = remainder % 128;
    const start = fullRuns * 2;
    encoded[start] = color;
    encoded[start + 1] = 0x80 + priorLength - 1;
    encoded[start + 2] = color;
    encoded[start + 3] = tailLength - 1;
  }
  return encoded;
}
function streamed(bytes, chunkSize = 7) {
  let max = 0;
  const fetcher = async () => {
    let p = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (p >= bytes.length) {
            controller.close();
            return;
          }
          const b = bytes.slice(p, p + chunkSize);
          p += b.length;
          max = Math.max(max, b.length);
          controller.enqueue(b);
        },
      }),
    );
  };
  return new StreamingFile(bytes.length, "fixture", fetcher);
}
test("selective parser preserves native identity across reorder and ignores recognition / last opened", async () => {
  const a = await indexNotebook(streamed(notebook()));
  const b = await indexNotebook(
    streamed(notebook({ order: [1, 0], status: "1", last: "2" })),
  );
  assert.equal(a.ids[0], b.ids[1]);
  assert.equal(a.pages[0].fingerprint, b.pages[1].fingerprint);
  assert.equal(a.pages[1].fingerprint, b.pages[0].fingerprint);
});

test("native file identity is optional, bounded and separate from page fingerprints", async () => {
  const plain = await indexNotebook(streamed(notebook()));
  const linked = await openByteNotebook("fixture.note", "1:100", streamed(notebook({ fileId: "F-fixture" })), async () => "1:100");
  assert.equal(linked.descriptor.fileId, "F-fixture");
  assert.equal(linked.descriptor.pages[0].fingerprint, plain.pages[0].fingerprint);
  linked.close();
  for (const fileId of ["", "x".repeat(257), "F\ninvalid"]) {
    const invalid = await indexNotebook(streamed(notebook({ fileId })));
    assert.equal(invalid.fileId, undefined);
  }
});

test("open notebook reads bounded optional device OCR without changing page fingerprints", async () => {
  const ocr = { elements: [{ label: "Fixture text", type: "Text", words: [{ label: "Fixture", "bounding-box": { x: 1, y: 1, width: 30, height: 10 } }, { label: "text", "bounding-box": { x: 32, y: 1, width: 20, height: 10 } }] }] };
  const bytes = notebook({ recognition: ocr });
  const source = streamed(bytes);
  const revision = "1:100";
  const opened = await openByteNotebook("fixture.note", revision, source, async () => revision);
  assert.equal(await opened.readOcr(1), "Fixture text");
  assert.equal(await opened.readOcr(2), "Fixture text");
  opened.close();
});

test("readOcrMany reads and parses several OCR blocks in one metadata-checked scan", async () => {
  const ocr = { elements: [{ label: "Fixture text", type: "Text", words: [{ label: "Fixture", "bounding-box": { x: 1, y: 1, width: 30, height: 10 } }, { label: "text", "bounding-box": { x: 32, y: 1, width: 20, height: 10 } }] }] };
  const bytes = notebook({ ids: ["one", "two", "three"], order: [0, 1, 2], ink: ["a", "b", "c"], recognition: ocr });
  const source = streamed(bytes), scan = source.scan.bind(source), events = [];
  source.scan = async (addresses, consume) => { events.push("scan"); return scan(addresses, consume); };
  const revision = "1:100";
  const opened = await openByteNotebook("fixture.note", revision, source, async () => revision, undefined,
    detail => events.push(detail));
  events.length = 0;
  assert.deepEqual(await opened.readOcrMany([3, 1, 2]), ["Fixture text", "Fixture text", "Fixture text"]);
  assert.equal(events.filter(event => event === "scan").length, 1);
  assert.equal(events[0], "Reading device OCR text", "progress stage is reported before the combined scan");
  opened.close();
});

test("readOcrMany rejects changed metadata and preserves per-page invalid OCR results", async () => {
  const ocr = { elements: [{ label: "Fixture text", type: "Text", words: [{ label: "Fixture", "bounding-box": { x: 1, y: 1, width: 30, height: 10 } }, { label: "text", "bounding-box": { x: 32, y: 1, width: 20, height: 10 } }] }] };
  let bytes = notebook({ ids: ["one", "two", "three"], order: [0, 1, 2], ink: ["a", "b", "c"], recognition: ocr });
  const revision = "1:100";
  const source = new StreamingFile(bytes.length, "fixture", async () => new Response(bytes));
  const opened = await openByteNotebook("fixture.note", revision, source, async () => revision);
  bytes = notebook({ ids: ["one", "two", "three"], order: [0, 1, 2], ink: ["a", "b", "c"], recognition: ocr, style: "1" });
  await assert.rejects(opened.readOcrMany([1, 2]), error => error.name === "SourceChangedError");
  opened.close();

  let scans = 0;
  const emptySource = streamed(notebook({ ids: ["one", "two", "three"], order: [0, 1, 2], ink: ["a", "b", "c"], recognitionAddress: "999999" }));
  const originalScan = emptySource.scan.bind(emptySource);
  emptySource.scan = async (...args) => { scans++; return originalScan(...args); };
  const noOcr = await openByteNotebook("fixture.note", revision, emptySource, async () => revision);
  scans = 0;
  assert.deepEqual(await noOcr.readOcrMany([1, 2, 3]), [undefined, undefined, undefined]);
  assert.equal(scans, 0, "no valid OCR addresses means no OCR or metadata scan");
  noOcr.close();
});

test("missing or out-of-bounds recognition address is optional", async () => {
  const absent = await openByteNotebook("fixture.note", "1:100", streamed(notebook()), async () => "1:100");
  assert.equal(await absent.readOcr(1), undefined);
  const invalid = await openByteNotebook("fixture.note", "1:100", streamed(notebook({ recognitionAddress: "999999" })), async () => "1:100");
  assert.equal(await invalid.readOcr(1), undefined);
});
test("bitmap and template changes invalidate page fingerprints", async () => {
  const a = await indexNotebook(streamed(notebook()));
  const b = await indexNotebook(streamed(notebook({ ink: ["edited", "b"] })));
  const c = await indexNotebook(streamed(notebook({ style: "user_template" })));
  assert.notEqual(a.pages[0].fingerprint, b.pages[0].fingerprint);
  assert.equal(a.pages[1].fingerprint, b.pages[1].fingerprint);
  assert.notEqual(a.pages[0].fingerprint, c.pages[0].fingerprint);
});
test("footer rejects zero-padded and nonpositive page keys", async () => {
  await assert.rejects(
    indexNotebook(streamed(notebook({ footerKeys: ["PAGE1", "PAGE01"] }))),
    /page key|footer/i,
  );
  await assert.rejects(
    indexNotebook(streamed(notebook({ footerKeys: ["PAGE0", "PAGE2"] }))),
    /page key|footer/i,
  );
});
test("missing or duplicated PAGEIDs use collision safe content identities", () => {
  assert.deepEqual(
    identities(["same", "same", undefined, undefined], ["a", "b", "c", "c"]),
    ["content:a:1", "content:b:1", "content:c:1", "content:c:2"],
  );
  assert.deepEqual(identities(["id"], ["a"]), ["native:id"]);
});
test("streaming rejects truncated and invalid block extents", async () => {
  const bad = new Uint8Array(32);
  new DataView(bad.buffer).setUint32(24, 100, true);
  await assert.rejects(
    streamed(bad).scan([24], () => {}),
    /invalid or excessively/,
  );
  const s = new StreamingFile(33, "fixture", async () => new Response(bad));
  await assert.rejects(s.tail(), /ended early/);
});
test("large sources scan bounded chunks without retaining whole notebook", async () => {
  const size = 110 * 1024 * 1024 + 4;
  let delivered = 0,
    maxChunk = 0;
  const fetcher = async () => {
    let offset = 0;
    return new Response(
      new ReadableStream({
        pull(c) {
          if (offset >= size) {
            c.close();
            return;
          }
          const b = new Uint8Array(Math.min(65536, size - offset));
          if (offset <= 24 && offset + b.length >= 29) {
            new DataView(b.buffer).setUint32(24 - offset, 1, true);
            b[28 - offset] = 42;
          }
          offset += b.length;
          delivered += b.length;
          maxChunk = Math.max(maxChunk, b.length);
          c.enqueue(b);
        },
      }),
    );
  };
  const s = new StreamingFile(size, "fixture", fetcher);
  let payload;
  await s.scan([24], (_a, b) => {
    payload = b;
  });
  assert.equal(payload[0], 42);
  assert.ok(delivered < size);
  assert.equal((await s.tail()).length, 4);
  assert.ok(maxChunk <= 65536);
});

test("insertion, deletion and edits retain identities without positional attachment", async () => {
  const old = await indexNotebook(streamed(notebook()));
  const inserted = await indexNotebook(
    streamed(
      notebook({
        ids: ["new", "one", "two"],
        ink: ["new ink", "a", "b"],
        order: [0, 1, 2],
      }),
    ),
  );
  assert.deepEqual(inserted.ids.slice(1), old.ids);
  assert.equal(inserted.pages[1].fingerprint, old.pages[0].fingerprint);
  const deleted = await indexNotebook(streamed(notebook({ order: [1] })));
  assert.equal(deleted.ids[0], old.ids[1]);
  const edited = await indexNotebook(
    streamed(notebook({ ink: ["changed", "b"] })),
  );
  assert.equal(edited.ids[0], old.ids[0]);
  assert.notEqual(edited.pages[0].fingerprint, old.pages[0].fingerprint);
});

test("single-notebook sources return validated stat without directory enumeration", async () => {
  const path = "/storage/emulated/0/Note/One.note";
  let reads = 0;
  const fs = {
    stat: async () => ({ type: "file", size: 400, mtime: 123 }),
    readdir: async () => {
      reads++;
      throw Error("Not a directory");
    },
    getUri: () => "",
  };
  const source = new AndroidReadOnlySource(fs);
  assert.deepEqual(await source.list(path, false, []), [
    { path, size: 400, mtime: 123 },
  ]);
  assert.deepEqual(await source.list(path, true, [" One.note "]), []);
  assert.equal(reads, 0);
  await assert.rejects(
    source.list("/storage/emulated/0/Note/data.txt", false, []),
    /not a notebook/,
  );
  await assert.rejects(
    source.list("/storage/emulated/0/Note/../One.note", false, []),
    /Invalid source/,
  );
  fs.stat = async () => {
    throw Error("File not found");
  };
  await assert.rejects(source.list(path, false, []), /File not found/);
});
test("indexing reports meaningful phases and streaming progress", async () => {
  const phases = [];
  await indexNotebook(streamed(notebook()), (detail) => phases.push(detail));
  assert.ok(phases.some((p) => p.includes("Fingerprinting")));
  assert.ok(phases.some((p) => p.includes("metadata")));
  const bytes = notebook(),
    ticks = [];
  const source = new StreamingFile(
    bytes.length,
    "fixture",
    async () => new Response(bytes),
    (offset, size) => ticks.push([offset, size]),
  );
  await source.tail();
  assert.ok(ticks.length >= 2);
  assert.equal(ticks[0][0], 0);
  assert.equal(ticks.at(-1)[1], bytes.length);
});
const visibility = (visible = true, deleted = false, current = false) =>
  `[{"layerId"#0,"name"#"Main: Ink","isVisible"#${visible},"isDeleted"#${deleted},"isCurrentLayer"#${current},"isAllowAdd"#false}]`;
test("explicit visibility and deletion change fingerprints; editing flags do not", async () => {
  const visible = await indexNotebook(
    streamed(notebook({ layerInfo: visibility() })),
  );
  const hidden = await indexNotebook(
    streamed(notebook({ layerInfo: visibility(false) })),
  );
  const deleted = await indexNotebook(
    streamed(notebook({ layerInfo: visibility(true, true) })),
  );
  const editing = await indexNotebook(
    streamed(notebook({ layerInfo: visibility(true, false, true) })),
  );
  assert.notEqual(visible.pages[0].fingerprint, hidden.pages[0].fingerprint);
  assert.equal(hidden.pages[0].fingerprint, deleted.pages[0].fingerprint);
  assert.equal(visible.pages[0].fingerprint, editing.pages[0].fingerprint);
  assert.deepEqual(hidden.pages[0].sequence, []);
  assert.deepEqual(hidden.pages[0].bitmaps, []);
});
test("hidden bitmap changes do not invalidate visible content fingerprint", async () => {
  const a = await indexNotebook(
    streamed(notebook({ layerInfo: visibility(false) })),
  );
  const b = await indexNotebook(
    streamed(
      notebook({ layerInfo: visibility(false), ink: ["private edit", "b"] }),
    ),
  );
  assert.equal(a.pages[0].fingerprint, b.pages[0].fingerprint);
});
test("ambiguous, malformed and incomplete visibility flags are rejected", async () => {
  for (const layerInfo of [
    "",
    "[]",
    visibility().replace('"isVisible"#true', '"isVisible"#"true"'),
    visibility().replace(
      '"isVisible"#true',
      '"isVisible"#true,"isVisible"#false',
    ),
    visibility().replace('"layerId"#0', '"layerId"#8'),
    visibility().replace('"isDeleted"#false,', ""),
    visibility() + ",",
  ]) {
    await assert.rejects(
      indexNotebook(streamed(notebook({ layerInfo }))),
      /visibility/,
    );
  }
});
test("render refuses changed bitmap or metadata even when Android stat time and size stay fixed", async () => {
  for(const replacement of [{ink:["ccc","bbb"]},{style:"1",ink:["aaa","bbb"]}]){
    let bytes=notebook({ink:["aaa","bbb"]});const size=bytes.length;
    const fs={stat:async()=>({type:"file",size,mtime:1}),readdir:async()=>[],getUri:()=>"fixture"};
    const source=new AndroidReadOnlySource(fs,undefined,async()=>new Response(bytes));
    const opened=await source.open("/storage/emulated/0/Note/changed.note");
    bytes=notebook(replacement);assert.equal(bytes.length,size);
    await assert.rejects(opened.render(1),e=>e.name==="SourceChangedError"&&/changed after indexing/.test(e.message));
    opened.close();
  }
});

test("fork reuses indexed bitmap hashes, survives original close, and releases the shared index", async () => {
  const bytes = notebook({ ink: [uniformRle(0x65), uniformRle(0x61)] });
  const source = streamed(bytes, 65536), scan = source.scan.bind(source), counts = new Map();
  source.scan = async (addresses, consume) => {
    for (const address of new Set(addresses)) counts.set(address, (counts.get(address) || 0) + 1);
    return scan(addresses, consume);
  };
  const revision = "1:100";
  const original = await openByteNotebook("fixture.note", revision, source, async () => revision);
  const bitmapAddress = bytes.blockAddresses.pages[0].bitmap;
  assert.equal(counts.get(bitmapAddress), 1, "index reads each bitmap once");

  const fork = await original.fork();
  assert.equal(counts.get(bitmapAddress), 1, "fork validates metadata without reading bitmap payloads");
  original.close();
  assert.match(await fork.render(1), /^data:image\/png;base64,/);
  assert.equal(counts.get(bitmapAddress), 2, "render reads the requested bitmap and checks its index-time hash");
  fork.close();
  await assert.rejects(original.fork(), /closed/);
});

test("fork rejects changed metadata or revision and render still rejects same-stat bitmap edits", async () => {
  const revision = "1:100";
  for (const mode of ["metadata", "footer", "revision", "bitmap"]) {
    let bytes = notebook({ ink: [uniformRle(0x65), uniformRle(0x61)] });
    let currentRevision = revision;
    const source = new StreamingFile(bytes.length, "fixture", async () => new Response(bytes));
    const opened = await openByteNotebook("fixture.note", revision, source, async () => currentRevision);
    if (mode === "metadata") bytes = notebook({ ink: [uniformRle(0x65), uniformRle(0x61)], style: "1" });
    if (mode === "footer") new DataView(bytes.buffer).setUint32(bytes.length - 4, bytes.blockAddresses.header, true);
    if (mode === "revision") currentRevision = "2:100";
    if (mode === "bitmap") bytes = notebook({ ink: [uniformRle(0x66), uniformRle(0x61)] });
    if (mode === "bitmap") {
      const fork = await opened.fork();
      await assert.rejects(fork.render(1), error => error.name === "SourceChangedError");
      fork.close();
    } else {
      await assert.rejects(opened.fork(), error => /changed/.test(error.message) &&
        (mode !== "footer" || error.name === "SourceChangedError"));
    }
    opened.close();
  }
});

test("renderMany scans eligible pages once in order and retains bitmap change guards", async () => {
  const ink = [uniformRle(0x65), uniformRle(0x61), uniformRle(0x63)];
  let bytes = notebook({ ids: ["one", "two", "three"], ink, order: [0, 1, 2] });
  const source = new StreamingFile(bytes.length, "fixture", async () => new Response(bytes));
  let scans = 0;
  const scan = source.scan.bind(source);
  source.scan = async (addresses, consume) => { scans++; return scan(addresses, consume); };
  const revision = "1:100";
  const opened = await openByteNotebook("fixture.note", revision, source, async () => revision);
  const before = scans;
  const images = await opened.renderMany([3, 1, 2]);
  assert.equal(scans - before, 1);
  assert.equal(images.length, 3);
  assert.ok(images.every(image => image.startsWith("data:image/png;base64,")));

  const fork = await opened.fork();
  bytes = notebook({ ids: ["one", "two", "three"], ink: [uniformRle(0x66), ink[1], ink[2]], order: [0, 1, 2] });
  await assert.rejects(fork.renderMany([1, 2]), error => error.name === "SourceChangedError");
  fork.close();
  opened.close();
});

test("all hidden layers render a full native white page", async () => {
  const bytes = notebook({
    ids: ["hidden"],
    ink: ["not valid RLE"],
    order: [0],
    layerInfo: visibility(false),
  });
  const fs = {
    stat: async () => ({ type: "file", size: bytes.length, mtime: 1 }),
    readdir: async () => [],
    getUri: () => "fixture",
  };
  const source = new AndroidReadOnlySource(
    fs,
    undefined,
    async () => new Response(bytes),
  );
  const opened = await source.open("/storage/emulated/0/Note/hidden.note");
  const image = await opened.render(1);
  opened.close();
  const { decodePng } = await import("image-js");
  const decoded = decodePng(Buffer.from(image.split(",")[1], "base64"));
  assert.equal(decoded.width, 1404);
  assert.equal(decoded.height, 1872);
  const raw = decoded.getRawImage();
  assert.ok(raw.data.every((value) => value === 255));
});
test("folder inventory shares glob semantics and prunes excluded directories before reading them", async () => {
  const root = "/storage/emulated/0/Note/Satsang",
    walked = [];
  const tree = {
    [root]: ["25 - Old.note", "26 - New.note", "Archive", "Branch"],
    [root + "/Archive"]: ["secret.note"],
    [root + "/Branch"]: ["25 - Nested.note", "26 - Nested.note"],
  };
  const fs = {
    stat: async (path) => ({
      type: tree[path] ? "directory" : "file",
      size: 10,
      mtime: 1,
    }),
    readdir: async (path) => {
      walked.push(path);
      return tree[path];
    },
    getUri: () => "",
  };
  const reader = new AndroidReadOnlySource(fs);
  const found = await reader.list(root, true, ["Archive", "**/25*.note"]);
  assert.deepEqual(
    found.map((f) => f.path),
    [root + "/26 - New.note", root + "/Branch/26 - Nested.note"],
  );
  assert.equal(walked.includes(root + "/Archive"), false);
});

test("selective preview reads and renders only the requested page ordinal",async()=>{
  const bytes=notebook({ids:["first","second"],ink:[uniformRle(0x65),uniformRle(0x61)]});
  const revision="1:100",readAddresses=[];
  const source=streamed(bytes,65536),scan=source.scan.bind(source);
  source.scan=async(addresses,callback)=>{readAddresses.push(...addresses);return scan(addresses,callback);};
  const image=await previewByteNotebook("fixture.note",2,revision,source,async()=>revision);
  const ordinary=await openByteNotebook("fixture.note",revision,streamed(bytes,65536),async()=>revision);
  try {
    assert.equal(image,await ordinary.render(2));
  } finally { ordinary.close(); }
  const blocks=bytes.blockAddresses;
  for(const address of Object.values(blocks.pages[0]))assert.equal(readAddresses.includes(address),false,`unselected block ${address} was read`);
  for(const address of Object.values(blocks.pages[1]))assert.equal(readAddresses.includes(address),true,`selected block ${address} was not read`);
});

test("selective preview rejects an invalid ordinal without reading any page payload blocks",async()=>{
  const bytes=notebook({ids:["first","second"],ink:[uniformRle(0x65),uniformRle(0x61)]});
  const revision="1:100",readAddresses=[];
  const source=streamed(bytes,65536),scan=source.scan.bind(source);
  source.scan=async(addresses,callback)=>{readAddresses.push(...addresses);return scan(addresses,callback);};
  await assert.rejects(previewByteNotebook("fixture.note",3,revision,source,async()=>revision),/page|ordinal|outside/i);
  for(const page of bytes.blockAddresses.pages)
    for(const address of Object.values(page))assert.equal(readAddresses.includes(address),false,`page payload ${address} was read before range rejection`);
});

test("selective preview rejects a source revision change during its read",async()=>{
  const bytes=notebook({ids:["first","second"],ink:[uniformRle(0x65),uniformRle(0x61)]});
  let revision="1:100";
  const source=streamed(bytes,65536),scan=source.scan.bind(source);
  source.scan=async(addresses,callback)=>{
    await scan(addresses,callback);
    if(addresses.includes(bytes.blockAddresses.pages[1].bitmap))revision="2:100";
  };
  await assert.rejects(previewByteNotebook("fixture.note",2,"1:100",source,async()=>revision),/changed|revision/i);
});

test("automatic new check hashes only new page bitmaps and preserves skipped fingerprints", async () => {
  const previousIndex = await indexNotebook(streamed(notebook()));
  const bytes = notebook({ ids: ["one", "new", "two"], ink: ["a", "fresh", "b"], order: [0, 1, 2] });
  const source = streamed(bytes), scan = source.scan.bind(source), scanned = [];
  source.scan = async (addresses, consume) => { scanned.push(...addresses); return scan(addresses, consume); };
  const options = { mode: "new", recentPages: 0, previous: previousIndex.pages.map((p, i) => ({ id: previousIndex.ids[i], number: i + 1, fingerprint: p.fingerprint })) };
  const result = await indexNotebook(source, () => {}, undefined, options);
  const bitmap = bytes.blockAddresses.pages;
  assert.deepEqual([...new Set(scanned.filter(a => bitmap.some(p => p.bitmap === a)))], [bitmap[1].bitmap]);
  assert.equal(result.pages[0].fingerprint, previousIndex.pages[0].fingerprint);
  assert.equal(result.pages[2].fingerprint, previousIndex.pages[1].fingerprint);
  assert.deepEqual(result.checkedPageIds, ["native:new"]);
  assert.equal(result.checkMode, "new");
});

test("new-only automatic check resumes pending current IDs and ignores unknown pending IDs", async () => {
  const previousIndex = await indexNotebook(streamed(notebook()));
  const bytes = notebook({ ids: ["one", "two"], ink: ["a", "b"] });
  const source = streamed(bytes), scan = source.scan.bind(source), scanned = [];
  source.scan = async (addresses, consume) => { scanned.push(...addresses); return scan(addresses, consume); };
  const previous = previousIndex.pages.map((p, i) => ({ id: previousIndex.ids[i], number: i + 1, fingerprint: p.fingerprint }));
  const result = await indexNotebook(source, () => {}, undefined,
    { mode: "new", recentPages: 0, previous, pendingPageIds: ["native:two", "native:deleted"] });
  const bitmaps = bytes.blockAddresses.pages;
  assert.deepEqual([...new Set(scanned.filter(a => bitmaps.some(p => p.bitmap === a)))], [bitmaps[1].bitmap]);
  assert.deepEqual(result.checkedPageIds, ["native:two"]);
  assert.equal(result.pages[0].fingerprint, previousIndex.pages[0].fingerprint);
});

test("recent automatic check includes new middle pages and the last N ordinals", async () => {
  const priorBytes = notebook({ ids: ["one", "two", "three"], ink: ["a", "b", "c"], order: [0, 1, 2] });
  const prior = await indexNotebook(streamed(priorBytes));
  const bytes = notebook({ ids: ["one", "new", "two", "three"], ink: ["a", "fresh", "b", "c"], order: [0, 1, 2, 3] });
  const source = streamed(bytes), scan = source.scan.bind(source), scanned = [];
  source.scan = async (addresses, consume) => { scanned.push(...addresses); return scan(addresses, consume); };
  const previous = prior.pages.map((p, i) => ({ id: prior.ids[i], number: i + 1, fingerprint: p.fingerprint }));
  const result = await indexNotebook(source, () => {}, undefined, { mode: "recent", recentPages: 1, previous });
  const bitmaps = bytes.blockAddresses.pages;
  assert.deepEqual([...new Set(scanned.filter(a => bitmaps.some(p => p.bitmap === a)))].sort((a,b)=>a-b), [bitmaps[1].bitmap, bitmaps[3].bitmap].sort((a,b)=>a-b));
  assert.deepEqual(result.checkedPageIds, ["native:new", "native:three"]);
  assert.equal(result.checkMode, "recent");
  assert.equal(result.pages[0].fingerprint, prior.pages[0].fingerprint);
  assert.equal(result.pages[2].fingerprint, prior.pages[1].fingerprint);
});

test("manual and all-mode indexing retain full fingerprints and bitmap coverage", async () => {
  const bytes = notebook({ ids: ["one", "two"] });
  const manual = await indexNotebook(streamed(bytes));
  const all = await indexNotebook(streamed(bytes), () => {}, undefined, { mode: "all", recentPages: 0, previous: [] });
  assert.deepEqual(all.pages.map(p => p.fingerprint), manual.pages.map(p => p.fingerprint));
  assert.deepEqual(all.ids, manual.ids);
  assert.equal(all.checkMode, "all");
  assert.equal(all.checkedPageIds.length, 2);
});

test("automatic checks refuse current fallback IDs and previous content fallback IDs", async () => {
  const prior = await indexNotebook(streamed(notebook()));
  const previous = prior.pages.map((p, i) => ({ id: prior.ids[i], number: i + 1, fingerprint: p.fingerprint }));
  await assert.rejects(indexNotebook(streamed(notebook({ ids: ["duplicate", "duplicate"] })), () => {}, undefined,
    { mode: "new", recentPages: 0, previous }), error => error.name === "AutomaticCheckUnavailableError" && /Run Update to check this notebook/.test(error.message));
  const current = await indexNotebook(streamed(notebook({ ids: ["one"], order: [0] })));
  await assert.rejects(indexNotebook(streamed(notebook({ ids: ["one"], order: [0] })), () => {}, undefined,
    { mode: "new", recentPages: 0, previous: [{ id: "content:old:1", number: 1, fingerprint: current.pages[0].fingerprint }] }),
  error => error.name === "AutomaticCheckUnavailableError" && /Run Update to check this notebook/.test(error.message));
  const firstBaseline = await indexNotebook(streamed(notebook({ ids: ["duplicate", "duplicate"] })), () => {}, undefined,
    { mode: "new", recentPages: 0, previous: [] });
  assert.equal(firstBaseline.checkMode, "all");
  assert.equal(firstBaseline.pages.every(p => p.fingerprint.length > 0), true);
});

test("automatic checked page still rejects same-stat bitmap mutation at render", async () => {
  const prior = await indexNotebook(streamed(notebook({ ids: ["one"], order: [0] })));
  let bytes = notebook({ ids: ["one", "new"], ink: ["a", "b"] });
  const size = bytes.length, revision = "1:100";
  const source = new StreamingFile(bytes.length, "fixture", async () => new Response(bytes));
  const opened = await openByteNotebook("fixture.note", revision, source, async () => revision, undefined, undefined, undefined,
    { mode: "new", recentPages: 0, previous: [{ id: prior.ids[0], number: 1, fingerprint: prior.pages[0].fingerprint }] });
  bytes = notebook({ ids: ["one", "new"], ink: ["a", "c"] });
  assert.equal(bytes.length, size);
  await assert.rejects(opened.render(2), error => error.name === "SourceChangedError");
  opened.close();
});

test("renderMany reads new and unchecked context pages in one scan and snapshots context bitmap", async () => {
  const prior = await indexNotebook(streamed(notebook({
    ids: ["one", "two"], ink: [uniformRle(0x65), uniformRle(0x63)],
  })));
  const bytes = notebook({
    ids: ["one", "new"], ink: [uniformRle(0x65), uniformRle(0x61)],
  });
  const source = streamed(bytes), scan = source.scan.bind(source), calls = [];
  source.scan = async (addresses, consume) => { calls.push([...addresses]); return scan(addresses, consume); };
  const previous = prior.pages.map((p, i) => ({ id: prior.ids[i], number: i + 1, fingerprint: p.fingerprint }));
  const opened = await openByteNotebook("fixture.note", "1:100", source, async () => "1:100", undefined, undefined, undefined,
    { mode: "new", recentPages: 0, previous });
  const [contextBitmap, newBitmap] = bytes.blockAddresses.pages.map(p => p.bitmap);
  const count = (address) => calls.filter(addresses => addresses.includes(address)).length;
  assert.equal(count(contextBitmap), 0, "unchecked context is not read while indexing");
  assert.equal(count(newBitmap), 1, "selected new page is read while indexing");
  const before = calls.length;
  const images = await opened.renderMany([1, 2]);
  assert.equal(calls.length - before, 1, "both pages share one bitmap scan");
  assert.equal(count(contextBitmap), 1);
  assert.equal(count(newBitmap), 2);
  assert.ok(images.every(image => image.startsWith("data:image/png;base64,")));
  opened.close();
});
