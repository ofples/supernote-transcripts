import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({ entryPoints: ["src/storage.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { inspectStorage, cleanStorage } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

const H = "a".repeat(64), H2 = "b".repeat(64), NOTEBOOK = "c".repeat(64), UNKNOWN = "d".repeat(64);
const HISTORY = "_supernote/History", SHARED = "_supernote/Shared Data";
const RESULT_HEADER = "<!-- nomad-transcripts-shared-v1 -->\n```json\n";
const RESULT_FOOTER = "\n```\n";
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
function memoryIO() {
  const files = new Map(), dirs = new Set(), mtimes = new Map();
  const parentDirs = path => { const parts = path.split("/"); for (let i=1;i<parts.length;i++) dirs.add(parts.slice(0,i).join("/")); };
  return { files, dirs, mtimes,
    exists: async p => files.has(p) || dirs.has(p), read: async p => { if(!files.has(p)) throw Error("missing"); return files.get(p); },
    write: async (p,t) => { parentDirs(p); files.set(p,t); },
    create: async (p,t) => { if(files.has(p)) throw Error("exists"); parentDirs(p); files.set(p,t); },
    mkdir: async p => { parentDirs(`${p}/x`); dirs.add(p); },
    list: async p => ({ files: [...files.keys()].filter(x => x.startsWith(`${p}/`) && !x.slice(p.length+1).includes("/")),
      folders: [...dirs].filter(x => x.startsWith(`${p}/`) && !x.slice(p.length+1).includes("/")) }),
    remove: async p => files.delete(p), rmdir: async p => dirs.delete(p),
    stat: async p => files.has(p) ? { size: Buffer.byteLength(files.get(p)), mtime: mtimes.get(p) ?? 1 } : null,
  };
}
function resultBody(r) { return RESULT_HEADER + JSON.stringify({ ...r, recordId: r.recordId }) + RESULT_FOOTER; }
async function addResult(io, { notebookId=NOTEBOOK, pageId="p1", fingerprint=H, recipe=H2, text="result", deviceId="device", createdAt=1, mtime=1, sharedRoot=SHARED }={}) {
  const payload = { kind:"result", version:1, notebookId, pageId, fingerprint, recipe, text, textHash:await hash(text), deviceId, createdAt, nonce:`nonce-${deviceId}-${createdAt}` };
  const recordId = await hash(JSON.stringify(payload));
  const query = await hash(JSON.stringify([pageId, fingerprint, recipe]));
  const path = `${sharedRoot}/${notebookId}/results/${query}/${recordId}.md`;
  await io.write(path, resultBody({ ...payload, recordId })); io.mtimes.set(path, mtime);
  return { path, ...payload, recordId };
}
async function publicationRaceFixture() {
  const io=memoryIO();
  const oldResult=await addResult(io,{pageId:"p1",text:"old publication result",createdAt:1,mtime:1});
  await addResult(io,{pageId:"p1",recipe:"f".repeat(64),text:"latest page result",createdAt:10,mtime:1});
  const { PublicationReceipts } = await import("data:text/javascript;base64," + Buffer.from((await build({entryPoints:["src/publication.ts"],bundle:true,platform:"node",format:"esm",write:false})).outputFiles[0].text).toString("base64"));
  let now=1;const receipts=new PublicationReceipts(io,()=>now);
  await receipts.save(NOTEBOOK,"old publication output",[{id:"p1",number:1,fingerprint:H}],{
    p1:{text:"old publication result",fingerprint:H,recipe:H2},
  });
  const oldHash=await hash("old publication output");
  now=2;await receipts.save(NOTEBOOK,"latest publication output",[],{});
  const newestHash=await hash("latest publication output");
  const oldPublication=`${SHARED}/${NOTEBOOK}/publications/${oldHash}/${[...io.files.keys()].find(p=>p.includes(`/publications/${oldHash}/`)).split("/").at(-1)}`;
  const newestPublication=[...io.files.keys()].find(p=>p.includes(`/publications/${newestHash}/`));
  io.mtimes.set(oldPublication,1);io.mtimes.set(newestPublication,2);
  const plan=await inspectStorage(io,opts({knownNotebooks:[{notebookId:NOTEBOOK,results:[],publicationHashes:[]}]}));
  return {io,oldPublication,oldResult,plan};
}
const opts = (extra={}) => ({ now: 100 * 24 * 60 * 60 * 1000, knownNotebooks:[], trackedHistory:[], ...extra });

test("retains unknown notebook caches and every newest tied cross-device result", async () => {
  const io = memoryIO();
  const tied1 = await addResult(io, { deviceId:"one", createdAt:90 });
  const tied2 = await addResult(io, { deviceId:"two", createdAt:90 });
  await addResult(io, { deviceId:"old", createdAt:1, mtime:1 });
  const privateResult = await addResult(io, { notebookId:UNKNOWN, deviceId:"unknown", createdAt:1, mtime:1 });
  const plan = await inspectStorage(io, opts({ knownNotebooks:[{notebookId:NOTEBOOK,results:[],publicationHashes:[]}]}));
  assert.deepEqual(plan.candidates.map(x=>x.path), [
    `${SHARED}/${NOTEBOOK}/results/${await hash(JSON.stringify(["p1",H,H2]))}/${(await addResultId("old"))}.md`,
  ]);
  assert.ok(!plan.candidates.some(x=>x.path===tied1.path || x.path===tied2.path || x.path===privateResult.path));
});
async function addResultId(device) {
  const payload = { kind:"result",version:1,notebookId:NOTEBOOK,pageId:"p1",fingerprint:H,recipe:H2,text:"result",textHash:await hash("result"),deviceId:device,createdAt:1,nonce:`nonce-${device}-1` };
  return hash(JSON.stringify(payload));
}

test("keeps current result references and explicit tracked-history protections", async () => {
  const io=memoryIO();
  const current=await addResult(io,{pageId:"current",text:"current",createdAt:1,mtime:1});
  const oldHistory=`${HISTORY}/Notebook/2026-01-01-old-transcript.md`;
  const keepHistory=`${HISTORY}/Notebook/2026-01-02-new-transcript.md`;
  const protectedFile=`${HISTORY}/Notebook/Restore metadata.md`;
  const legacyOld=`${HISTORY}/Other/2026-01-03T05-10-22-000Z-11111111-1111-4111-8111-111111111111.md`;
  const legacyNewest=`${HISTORY}/Other/2026-01-04T05-10-22-000Z-22222222-2222-4222-8222-222222222222.md`;
  const unresolvedCleanup=`${HISTORY}/Notebook/2026-01-05-cleanup-result.md`;
  await io.write(oldHistory,"old"); io.mtimes.set(oldHistory,1);
  await io.write(keepHistory,"new"); io.mtimes.set(keepHistory,2);
  await io.write(protectedFile,"metadata");
  await io.write(legacyOld,"old cleanup"); io.mtimes.set(legacyOld,3);
  await io.write(legacyNewest,"new cleanup"); io.mtimes.set(legacyNewest,4);
  await io.write(unresolvedCleanup,"paid result"); io.mtimes.set(unresolvedCleanup,1);
  const fixedUndo=`${HISTORY}/Notebook--${NOTEBOOK.slice(0,12)}/Previous version.md`;
  await io.write(fixedUndo,"undo record");
  const plan=await inspectStorage(io,opts({trackedHistory:[oldHistory,keepHistory,protectedFile,legacyOld,legacyNewest,unresolvedCleanup,fixedUndo],protectedHistory:[oldHistory],knownNotebooks:[{
    notebookId:NOTEBOOK,results:[{pageId:"current",fingerprint:H,recipe:H2,textHash:current.textHash}],publicationHashes:[]}]}));
  assert.deepEqual(plan.candidates.map(c=>c.path),[legacyOld]);
  assert.ok(!plan.candidates.some(c=>[legacyNewest,unresolvedCleanup,fixedUndo].includes(c.path)));
});

test("timestamped legacy transcript backups keep only the newest in each folder; unknown names stay", async () => {
  const io=memoryIO(), folder=`${HISTORY}/Recovered`;
  const older=`${folder}/2026-10-10T05-10-22-000Z-11111111-1111-4111-8111-111111111111.md`;
  const newest=`${folder}/2026-10-11T05-10-22-000Z-22222222-2222-4222-8222-222222222222.md`;
  const unknown=`${folder}/manual-final.md`;
  for (const p of [older,newest,unknown]) await io.write(p,p);
  // A newly received older backup must not replace the actual newest version.
  io.mtimes.set(older,30);io.mtimes.set(newest,20);io.mtimes.set(unknown,1);
  const plan=await inspectStorage(io,opts({trackedHistory:[older,newest,unknown]}));
  assert.deepEqual(plan.candidates.map(c=>c.path),[older]);
});

test("publication cleanup retains protected and newest hashes, and only prunes old validated hashes", async () => {
  const io=memoryIO();
  const { PublicationReceipts } = await import("data:text/javascript;base64," + Buffer.from((await build({entryPoints:["src/publication.ts"],bundle:true,platform:"node",format:"esm",write:false})).outputFiles[0].text).toString("base64"));
  let now=1; const receipts=new PublicationReceipts(io,()=>now);
  await receipts.save(NOTEBOOK,"old publication",[],{}); const oldHash=await hash("old publication");
  now=3; await receipts.save(NOTEBOOK,"new publication",[],{}); const newestHash=await hash("new publication");
  now=2; await receipts.save(NOTEBOOK,"protected publication",[],{}); const protectedHash=await hash("protected publication");
  now=1; await receipts.save(NOTEBOOK,"recently synced old publication",[],{}); const syncedOldHash=await hash("recently synced old publication");
  const oldPath=[...io.files.keys()].find(p=>p.includes(`/publications/${oldHash}/`));
  const newPath=[...io.files.keys()].find(p=>p.includes(`/publications/${newestHash}/`));
  const protectedPath=[...io.files.keys()].find(p=>p.includes(`/publications/${protectedHash}/`));
  const syncedOldPath=[...io.files.keys()].find(p=>p.includes(`/publications/${syncedOldHash}/`));
  assert.equal((await receipts.findHash(NOTEBOOK,oldHash)).createdAt,1);
  assert.equal((await receipts.findHash(NOTEBOOK,newestHash)).createdAt,3);
  assert.equal((await receipts.findHash(NOTEBOOK,protectedHash)).createdAt,2);
  io.mtimes.set(oldPath,1);io.mtimes.set(newPath,2);io.mtimes.set(protectedPath,3);
  io.mtimes.set(syncedOldPath,opts().now-1000);
  const plan=await inspectStorage(io,opts({knownNotebooks:[{notebookId:NOTEBOOK,results:[],publicationHashes:[protectedHash]}]}));
  assert.ok(plan.candidates.some(c=>c.path===oldPath));
  assert.ok(!plan.candidates.some(c=>c.path===newPath || c.path===protectedPath || c.path===syncedOldPath));
});

test("retained publication receipts protect old result records outside current and newest refs", async () => {
  const io=memoryIO();
  const { PublicationReceipts } = await import("data:text/javascript;base64," + Buffer.from((await build({entryPoints:["src/publication.ts"],bundle:true,platform:"node",format:"esm",write:false})).outputFiles[0].text).toString("base64"));
  const referenced=await addResult(io,{pageId:"p1",text:"old recipe result",createdAt:1,mtime:1});
  const latest=await addResult(io,{pageId:"p1",recipe:"f".repeat(64),text:"latest recipe result",createdAt:10,mtime:1});
  let createdAt=20; const receipts=new PublicationReceipts(io,()=>createdAt);
  await receipts.save(NOTEBOOK,"published output",[{id:"p1",number:1,fingerprint:H}],{
    p1:{text:"old recipe result",fingerprint:H,recipe:H2},
  });
  createdAt=21;
  await receipts.save(NOTEBOOK,"published output",[{id:"p1",number:1,fingerprint:H}],{
    p1:{text:"latest recipe result",fingerprint:H,recipe:"f".repeat(64)},
  });
  const plan=await inspectStorage(io,opts({knownNotebooks:[{notebookId:NOTEBOOK,results:[],publicationHashes:[]}]}));
  assert.ok(!plan.candidates.some(c=>c.path===referenced.path || c.path===latest.path));
});

test("malformed cache records and publication conflict files remain protected", async () => {
  const io=memoryIO();
  const malformed=`${SHARED}/${NOTEBOOK}/results/${H}/${"e".repeat(64)}.md`;
  await io.write(malformed,"broken");
  const old=await addResult(io,{pageId:"protected-page",recipe:H2,text:"old referenced",createdAt:1,mtime:1});
  const recent=await addResult(io,{pageId:"protected-page",recipe:"f".repeat(64),text:"recent result",createdAt:10,mtime:1});
  const conflictHash=await hash("conflict publication"),folder=`${SHARED}/${NOTEBOOK}/publications/${conflictHash}`;
  await io.write(`${folder}/${"f".repeat(64)} (conflict).md`,"broken");
  const plan=await inspectStorage(io,opts({knownNotebooks:[{notebookId:NOTEBOOK,results:[],publicationHashes:[]}]}));
  assert.ok(!plan.candidates.some(c=>c.path===malformed || c.path.startsWith(`${folder}/`)));
  assert.ok(!plan.candidates.some(c=>c.path===old.path || c.path===recent.path));
});

test("inspection drops candidates whose bytes change after integrity classification", async () => {
  const {io,oldPublication,oldResult}=await publicationRaceFixture();
  assert.ok(io.files.has(oldPublication));
  const read=io.read;let count=0;
  io.read=async path=>{
    if(path===oldPublication && ++count===4){io.files.set(path,"changed during inspection");return "changed during inspection";}
    return read(path);
  };
  const plan=await inspectStorage(io,opts({knownNotebooks:[{notebookId:NOTEBOOK,results:[],publicationHashes:[]}]}));
  assert.ok(!plan.candidates.some(c=>c.path===oldPublication));
  assert.ok(!plan.candidates.some(c=>c.path===oldResult.path));
});

test("failed publication deletion blocks dependent result deletion for that notebook", async () => {
  const {io,oldPublication,oldResult,plan}=await publicationRaceFixture();
  assert.ok(plan.candidates.some(c=>c.path===oldPublication));
  assert.ok(plan.candidates.some(c=>c.path===oldResult.path));
  io.files.set(oldPublication,"changed after inspection");
  const result=await cleanStorage(io,plan);
  assert.ok(io.files.has(oldPublication));
  assert.ok(io.files.has(oldResult.path));
  assert.equal(result.removedFiles,0);
});

test("cleaning rechecks file content and removes only folders proven empty", async () => {
  const io=memoryIO(), old=`${HISTORY}/Notebook/old.md`, changed=`${HISTORY}/Notebook/changed.md`;
  await io.write(old,"old"); await io.write(changed,"before");
  await io.write(`${SHARED}/${NOTEBOOK}/keep.md`,`protected`);
  io.dirs.add(`${HISTORY}/Empty`);
  io.files.set(changed,"after");
  const plan={candidates:[{path:old,text:"old",bytes:3},{path:changed,text:"before",bytes:6},{path:"C:/outside.md",text:"x",bytes:1}],
    emptyFolders:[`${HISTORY}/Empty`,`${HISTORY}/Notebook`,`${SHARED}/${NOTEBOOK}`,"C:/outside"]};
  const result=await cleanStorage(io,plan);
  assert.deepEqual(result,{removedFiles:1,removedBytes:3});
  assert.equal(io.files.has(old),false);assert.equal(io.files.get(changed),"after");assert.equal(io.files.has(`${SHARED}/${NOTEBOOK}/keep.md`),true);
  assert.equal(io.dirs.has(`${HISTORY}/Empty`),false);assert.equal(io.dirs.has(`${HISTORY}/Notebook`),true);assert.equal(io.dirs.has(`${SHARED}/${NOTEBOOK}`),true);
});

test("cleaning rejects forged claims and mirror paths even when listed as candidates", async () => {
  const io=memoryIO(), claim=`${SHARED}/${NOTEBOOK}/claims/claim.md`, mirror=`${SHARED}/${NOTEBOOK}/mirrors/item.md`;
  await io.write(claim,"claim");await io.write(mirror,"mirror");
  const plan={candidates:[{path:claim,text:"claim",bytes:5},{path:mirror,text:"mirror",bytes:6}],emptyFolders:[]};
  assert.deepEqual(await cleanStorage(io,plan),{removedFiles:0,removedBytes:0});
  assert.equal(io.files.get(claim),"claim");assert.equal(io.files.get(mirror),"mirror");
});

test("custom data root scopes inspection and cleanup to its own History and Shared Data", async () => {
  const io = memoryIO(), custom = "Device Data", old = `${custom}/History/Notebook/old.md`;
  await io.write(old, "old");
  await io.write(`${HISTORY}/Notebook/keep.md`, "keep");
  const options = opts({ dataRoot: custom, trackedHistory: [old] });
  const plan = await inspectStorage(io, options);
  assert.equal(plan.dataRoot, custom);
  assert.equal(plan.historyFiles, 1);
  assert.deepEqual(plan.candidates.map(x => x.path), []); // The newest backup is retained.
  const forgedPlan = { dataRoot: custom, candidates: [{ path: old, text: "old", bytes: 3 }], emptyFolders: [] };
  assert.deepEqual(await cleanStorage(io, forgedPlan), { removedFiles: 1, removedBytes: 3 });
  assert.equal(io.files.get(`${HISTORY}/Notebook/keep.md`), "keep");
});

async function nestedPublicationFixture(retainOldPublication) {
  const io = memoryIO(), dataRoot = "System/Supernote", sharedRoot = `${dataRoot}/Shared Data`;
  const oldResult = await addResult(io, { text: "old publication result", createdAt: 1, mtime: 1, sharedRoot });
  const newestResult = await addResult(io, { recipe: "f".repeat(64), text: "latest page result", createdAt: 10, mtime: 1, sharedRoot });
  const { PublicationReceipts } = await import("data:text/javascript;base64," + Buffer.from((await build({
    entryPoints: ["src/publication.ts"], bundle: true, platform: "node", format: "esm", write: false,
  })).outputFiles[0].text).toString("base64"));
  let createdAt = 1;
  const receipts = new PublicationReceipts(io, sharedRoot, () => createdAt);
  await receipts.save(NOTEBOOK, "old publication output", [{ id: "p1", number: 1, fingerprint: H }], {
    p1: { text: oldResult.text, fingerprint: H, recipe: H2 },
  });
  const oldHash = await hash("old publication output");
  createdAt = 2;
  await receipts.save(NOTEBOOK, "latest publication output", [], {});
  const newestHash = await hash("latest publication output");
  const oldPublication = [...io.files.keys()].find(path => path.startsWith(`${sharedRoot}/${NOTEBOOK}/publications/${oldHash}/`));
  const newestPublication = [...io.files.keys()].find(path => path.startsWith(`${sharedRoot}/${NOTEBOOK}/publications/${newestHash}/`));
  io.mtimes.set(oldPublication, 1); io.mtimes.set(newestPublication, 2);
  const plan = await inspectStorage(io, opts({ dataRoot, knownNotebooks: [{ notebookId: NOTEBOOK, results: [], publicationHashes: retainOldPublication ? [oldHash] : [] }] }));
  return { io, plan, oldHash, oldPublication, oldResult, newestResult };
}

test("nested support roots validate receipts and preserve their referenced cache results", async () => {
  const { plan, oldPublication, oldResult, newestResult } = await nestedPublicationFixture(true);
  assert.equal(plan.historyFiles, 0);
  assert.ok(!plan.candidates.some(candidate => candidate.path === oldPublication));
  assert.ok(!plan.candidates.some(candidate => candidate.path === oldResult.path));
  assert.ok(!plan.candidates.some(candidate => candidate.path === newestResult.path));
});

test("nested support roots prune old validated publication folders and unreferenced results", async () => {
  const { io, plan, oldPublication, oldResult, newestResult } = await nestedPublicationFixture(false);
  assert.ok(plan.candidates.some(candidate => candidate.path === oldPublication));
  assert.ok(plan.candidates.some(candidate => candidate.path === oldResult.path));
  assert.ok(!plan.candidates.some(candidate => candidate.path === newestResult.path));
  await cleanStorage(io, plan);
  assert.equal(io.files.has(oldPublication), false);
  assert.equal(io.files.has(oldResult.path), false);
  assert.equal(await io.exists(oldPublication.slice(0, oldPublication.lastIndexOf("/"))), false);
  assert.equal(await io.exists(oldResult.path.slice(0, oldResult.path.lastIndexOf("/"))), false);
});

test("nested support roots keep dependent cache results when receipt deletion fails", async () => {
  const { io, plan, oldPublication, oldResult } = await nestedPublicationFixture(false);
  const remove = io.remove;
  io.remove = async path => {
    if (path === oldPublication) throw Error("simulated locked receipt");
    return remove(path);
  };
  await cleanStorage(io, plan);
  assert.ok(io.files.has(oldPublication));
  assert.ok(io.files.has(oldResult.path));
});
