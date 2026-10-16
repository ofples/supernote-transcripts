import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory=fileURLToPath(new URL("../",import.meta.url));
await mkdir(`${directory}test-artifacts`,{recursive:true});
await build({stdin:{contents:`export * from './src/publication'; export * from './src/shared'; export {default as Runtime} from './src/runtime'; export {buildMarkdown} from './src/reconcile.mjs';`,resolveDir:directory},
  outfile:`${directory}test-artifacts/publication-test.mjs`,bundle:true,format:"esm",platform:"browser",external:["fs","http","os"],loader:{".txt":"text"},
  plugins:[{name:"mock-runtime",setup(build){
    build.onResolve({filter:/^obsidian$/},()=>({path:`${directory}tests/mock-obsidian.mjs`}));
    build.onResolve({filter:/^\.\/reader$/},args=>args.importer.endsWith("runtime.ts")?({path:`${directory}tests/mock-reader.mjs`}):undefined);
    build.onResolve({filter:/^\.\/ui$/},()=>({path:`${directory}tests/mock-ui.mjs`}));
    build.onResolve({filter:/^\.\/desktop-reader$/},()=>({path:"desktop-reader",namespace:"mock-desktop-reader"}));
    build.onLoad({filter:/.*/,namespace:"mock-desktop-reader"},()=>({contents:"export class DesktopReadOnlySource {}"}));
  }}]});
const {PublicationReceipts,canAdvancePublication,canAdoptPublication,SharedNotebookCache,notebookIdentity,sharedHash,Runtime,buildMarkdown}=
  await import("../test-artifacts/publication-test.mjs");
const page=(id,fingerprint,number=1)=>({id,fingerprint,number});
const p1=page("native:1","f1"),p2=page("native:2","f2",2);
const receipt=pages=>({version:1,notebookId:"0".repeat(64),textHash:"1".repeat(64),pages});
function memoryIO(){
  const files=new Map(),folders=new Set();
  return {files,folders,
    exists:async p=>files.has(p)||folders.has(p),
    read:async p=>{if(!files.has(p))throw Error("missing");return files.get(p);},
    write:async(p,t)=>files.set(p,t),
    create:async(p,t)=>{if(files.has(p))throw Error("exists");files.set(p,t);},
    mkdir:async p=>folders.add(p),
    list:async p=>({files:[...files.keys()].filter(f=>f.startsWith(p+"/")&&!f.slice(p.length+1).includes("/")),folders:[]}),
  };
}
test("publication can follow locally observed edits, deletion, addition and reordering",()=>{
  assert.equal(canAdvancePublication(receipt([p1,p2]),[page(p1.id,"edited"),p2],[p1,p2]),true);
  assert.equal(canAdvancePublication(receipt([p1,p2]),[p1],[p1,p2]),true);
  assert.equal(canAdvancePublication(receipt([p1]),[p1,p2],[p1]),true);
  assert.equal(canAdvancePublication(receipt([p1,p2]),[p2,p1],[p1,p2]),true);
  assert.equal(canAdvancePublication(receipt([p1,p2]),[p1,p2],[]),true);
});
test("unknown received edits and additions cannot be replaced by stale local pages",()=>{
  assert.equal(canAdvancePublication(receipt([page(p1.id,"remote-edited")]),[p1],[p1]),false);
  assert.equal(canAdvancePublication(receipt([p1,p2]),[p1],[p1]),false);
});
test("unknown received deletions and reordering cannot be undone by stale local pages",()=>{
  assert.equal(canAdvancePublication(receipt([p1]),[p1,p2],[p1,p2]),false);
  assert.equal(canAdvancePublication(receipt([p2,p1]),[p1,p2],[p1,p2]),false);
  assert.equal(canAdvancePublication(receipt([p1]),[p1,p2],[]),false);
});
test("receipts match notebook and exact output content and preserve immutable metadata",async()=>{
  const io=memoryIO(),book=new PublicationReceipts(io),id=await notebookIdentity("r","a.note");
  await book.save(id,"Markdown",[p1,p2]);
  assert.deepEqual((await book.find(id,"Markdown")).pages,[{id:p1.id,fingerprint:p1.fingerprint},{id:p2.id,fingerprint:p2.fingerprint}]);
  assert.equal(await book.find(id,"manually changed Markdown"),undefined);
  assert.equal(await book.find(await notebookIdentity("r","b.note"),"Markdown"),undefined);
  const before=new Map(io.files);
  await book.save(id,"Markdown",[p1,p2]);assert.deepEqual(io.files,before);
  await book.save(id,"Markdown",[p1]);
  for(const [path,text] of before)assert.equal(io.files.get(path),text);
  assert.deepEqual((await book.find(id,"Markdown")).pages,[{id:p1.id,fingerprint:p1.fingerprint}]);
});
test("malformed receipt structures return no ownership evidence",async()=>{
  const io=memoryIO(),book=new PublicationReceipts(io),id=await notebookIdentity("r","a.note");
  await book.save(id,"Markdown",[p1]);const path=[...io.files.keys()][0],body=io.files.get(path);
  const parsed=JSON.parse(body.slice(body.indexOf("\n")+1));
  for(const value of [null,{}, {...parsed,pages:[null]}, {...parsed,pages:[{}]}, {...parsed,pages:[{id:"",fingerprint:""}]}, {...parsed,pages:[p1,p1]}]){
    io.files.set(path,"<!-- supernote-publication-v2 -->\n"+JSON.stringify(value)+"\n");
    assert.equal(await book.find(id,"Markdown"),undefined);
  }
});

const source="/storage/emulated/0/Note/Reflections/a.note";
function runtimeFixture(pages=[p1],io=memoryIO()){
  const storage=new Map();
  globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  globalThis.document={hidden:false};globalThis.window={setInterval:()=>0,setTimeout:()=>0};
  const app={vault:{adapter:{...io,process:async(p,f)=>io.files.set(p,f(io.files.get(p)))},configDir:".obsidian-test",
    getName:()=>"Publication Test",createFolder:io.mkdir,create:io.create},workspace:{onLayoutReady:()=>{},openLinkText:async()=>{}}};
  const plugin=new Runtime(app);
  plugin.config={version:1,profiles:[{id:"general",name:"General",model:"mock",endpoint:"https://example.invalid/responses",prompt:"transcribe",glossaries:[]}],
    rules:[{id:"r",sharedId:"shared-rule",enabled:true,source:"/storage/emulated/0/Note/Reflections",output:"Mirror",recursive:true,exclude:[],profileId:"general"}],intervalMinutes:5,batchPages:50,continuous:true,showPageHeadings:false};
  const cache=new SharedNotebookCache(io,"local-device",{sleep:async()=>{},settleMs:0});plugin.sharedCache=cache;
  let current=structuredClone(pages),revision="1:100";
  const reader={list:async()=>[{path:source,size:100,mtime:Number(revision.split(":")[0])}],revision:async()=>revision,
    open:async()=>({descriptor:{path:source,revision,pages:structuredClone(current),width:1404,height:1872},render:async n=>`mock-image:${n}`,close(){}})};
  plugin.reader=()=>reader;plugin.aiEnabled=true;
  const calls=[];plugin.transcribe=async(image,n,profile,reference,source,recipe,claimReady,fingerprint,group)=>{calls.push(...(group?.targets??[{number:n}]).map(p=>p.number));return JSON.stringify({pages:(group?.targets??[{number:n}]).map(p=>({number:p.number,text:`recognized ${p.number}`,joinPrevious:false}))});};
  return {plugin,io,cache,calls,app,reader,change:next=>{current=structuredClone(next);revision=`${Number(revision.split(":")[0])+1}:100`;}};
}
async function sharedKey(){return notebookIdentity("shared-rule","a.note");}
test("runtime reads received matching results without mock inference and protects personal output",async()=>{
  const f=runtimeFixture();const resolved=await f.plugin.profile("general");
  await f.cache.saveResult({notebookId:await sharedKey(),pageId:p1.id,fingerprint:p1.fingerprint,recipe:resolved.recipe},"already paid text");
  await f.plugin.update();assert.deepEqual(f.calls,[]);
  const state=f.plugin.store.notebooks[source];assert.equal(state.pages[p1.id].text,"already paid text");
  assert.match(f.io.files.get(state.output),/already paid text/);
  f.io.files.set(state.output,"# Personal handwritten note\nPreserve me.");
  f.change([page(p1.id,"edited")]);await f.plugin.update();
  assert.equal(f.io.files.get(state.output),"# Personal handwritten note\nPreserve me.");assert.deepEqual(f.calls,[]);
});
test("runtime blocks unknown remote fingerprint changes even when recognized text is identical",async()=>{
  const f=runtimeFixture();const resolved=await f.plugin.profile("general"),id=await sharedKey();
  await f.cache.saveResult({notebookId:id,pageId:p1.id,fingerprint:p1.fingerprint,recipe:resolved.recipe},"same words");
  const remoteState={output:"Mirror/a.md",desired:[page(p1.id,"remote-new-fingerprint")],pages:{[p1.id]:{fingerprint:"remote-new-fingerprint",recipe:resolved.recipe,text:"same words",number:1}}};
  const text=buildMarkdown(remoteState,false);
  f.io.files.set("Mirror/a.md",text);await new PublicationReceipts(f.io).save(id,text,remoteState.desired);
  await f.plugin.update();
  const state=f.plugin.store.notebooks[source];
  assert(["conflict","failed"].includes(state.status));
  assert.equal(f.io.files.get(state.output),text);assert.deepEqual(f.calls,[]);
});
test("runtime saves every successful in-flight result when a page fails, and continues further dispatch",async()=>{
  const f=runtimeFixture([p1,p2,page("native:3","f3",3)]);f.plugin.concurrency=2;
  let resolveSecond,firstStarted,secondStarted;
  const first=new Promise(r=>{firstStarted=r;}),second=new Promise(r=>{secondStarted=r;});
  const paidSecond=new Promise(r=>{resolveSecond=r;});
  f.plugin.transcribe=async(image,n,profile,reference,source,recipe,claimReady,fingerprint,group)=>{f.calls.push(n);if(n===1){firstStarted();await second;throw Error("mock request failed");}secondStarted();await paidSecond;return JSON.stringify({pages:(group?.targets??[{number:n}]).map(p=>({number:p.number,text:"second paid success",joinPrevious:false}))});};
  const operation=f.plugin.update();await first;await second;
  let finished=false;operation.then(()=>{finished=true;});await Promise.resolve();await Promise.resolve();
  assert.equal(finished,false);resolveSecond();await operation;
  assert.deepEqual(f.calls,[1,2,3]);
  const state=f.plugin.store.notebooks[source];assert.equal(state.pages[p2.id].text,"second paid success");
  assert.equal(state.status,"partial");assert.equal(state.pageIssues[p1.id].status,"failed");
  const recipe=(await f.plugin.profile("general")).recipe;
  const hit=await f.cache.findResult({notebookId:await sharedKey(),pageId:p2.id,fingerprint:p2.fingerprint,recipe});
  assert.equal(hit.chosen.text,"second paid success");
  const persisted=[...f.io.files].filter(([path])=>/\/state-[ab]\.json$/.test(path)).map(([,body])=>JSON.parse(body)).sort((a,b)=>b.generation-a.generation)[0];
  assert.equal(persisted.store.notebooks[source].pages[p2.id].text,"second paid success");
});
test("runtime keeps generated Markdown manual edits and makes no new inference request",async()=>{
  const f=runtimeFixture();await f.plugin.update();const state=f.plugin.store.notebooks[source],original=f.io.files.get(state.output);
  f.io.files.set(state.output,original+"\nManual correction\n");f.change([page(p1.id,"edited")]);await f.plugin.update();
  assert.equal(f.io.files.get(state.output),original+"\nManual correction\n");assert.deepEqual(f.calls,[1]);assert.equal(state.status,"conflict");
});
test("same-text sequential snapshots preserve both immutable records and tolerate delayed prior delivery",async()=>{
  const io=memoryIO(),book=new PublicationReceipts(io,()=>1_000),id=await sharedKey();
  await book.save(id,"same recognized words",[p1]);
  const first=new Map(io.files);
  const edited=page(p1.id,"new-handwriting-fingerprint");
  await book.save(id,"same recognized words",[edited]);
  assert.equal(io.files.size,2);
  const newest=await book.find(id,"same recognized words");
  assert.deepEqual(newest.pages,[{id:edited.id,fingerprint:edited.fingerprint}]);
  assert.equal(newest.candidates,undefined);
  assert.equal(canAdvancePublication(newest,[p1],[p1]),false);
  assert.equal(canAdvancePublication(newest,[edited],[p1]),true);
  for(const [path,body] of first){io.files.delete(path);io.files.set(path,body);}
  assert.deepEqual((await book.find(id,"same recognized words")).pages,newest.pages);
});
test("simultaneous same-text different snapshots remain ambiguous regardless of device clock",async()=>{
  const left=memoryIO(),right=memoryIO(),id=await sharedKey();
  const a=new PublicationReceipts(left,()=>9_000),b=new PublicationReceipts(right,()=>1_000);
  await a.save(id,"same words",[p1]);await b.save(id,"same words",[page(p1.id,"remote")]);
  for(const [path,body] of right.files)left.files.set(path,body);
  const found=await a.find(id,"same words");
  assert.equal(found.candidates.length,2);
  assert.equal(canAdvancePublication(found,[p1],[p1]),false);
  assert.equal(canAdvancePublication(found,[page(p1.id,"remote")],[p1]),true);
});
test("receipt metadata tampering provides no ownership evidence and cannot overwrite history",async()=>{
  const io=memoryIO(),book=new PublicationReceipts(io),id=await sharedKey();
  await book.save(id,"words",[p1]);
  const path=[...io.files.keys()][0],body=io.files.get(path),r=JSON.parse(body.slice(body.indexOf("\n")+1));
  r.pages[0].fingerprint="tampered";
  io.files.set(path,"<!-- supernote-publication-v2 -->\n"+JSON.stringify(r)+"\n");
  assert.equal(await book.find(id,"words"),undefined);
  await assert.rejects(book.save(id,"words",[p1]),/damaged/);
  assert.equal(io.files.get(path).includes("tampered"),true);
});
test("received output waits for its finished page results, while unrecognized pages permit new work",async()=>{
  const io=memoryIO(),book=new PublicationReceipts(io),id=await sharedKey(),recipe=await sharedHash("recipe");
  const remoteResults={[p1.id]:{fingerprint:p1.fingerprint,text:"remote paid result",recipe,number:1}};
  await book.save(id,"partial transcript with page 2 awaiting",[p1,p2],remoteResults);
  const r=await book.find(id,"partial transcript with page 2 awaiting");
  assert.equal(r.results.length,1);
  assert.equal(await canAdoptPublication(r,[p1,p2],{}),false);
  assert.equal(await canAdoptPublication(r,[p1,p2],{[p1.id]:{...remoteResults[p1.id],fingerprint:"old"}}),false);
  assert.equal(await canAdoptPublication(r,[p1,p2],remoteResults),true);
  assert.equal(await canAdoptPublication(r,[p1,p2],{...remoteResults,[p2.id]:{fingerprint:p2.fingerprint,text:"new local result",recipe,number:2}}),true);
});
test("result-aware adoption permits known replacements/deletion and protects same-fingerprint alternatives",async()=>{
  const io=memoryIO(),book=new PublicationReceipts(io),id=await sharedKey(),recipe=await sharedHash("recipe");
  const oldResult={fingerprint:"old",text:"old paid text",recipe,number:1};
  await book.save(id,"old transcript",[p1],{[p1.id]:oldResult});
  const r=await book.find(id,"old transcript");
  assert.equal(await canAdoptPublication(r,[p1],{[p1.id]:{...oldResult,fingerprint:p1.fingerprint,text:"new local replacement"}}),true);
  assert.equal(await canAdoptPublication(r,[],{}),true);
  assert.equal(await canAdoptPublication(r,[page(p1.id,"old")],{[p1.id]:{...oldResult,text:"alternate competing text"}}),false);
  assert.equal(await canAdoptPublication(r,[page(p1.id,"old")],{[p1.id]:{...oldResult,recipe:await sharedHash("another recipe")}}),false);
});
test("runtime preserves received finished output while its shared result file is still delayed",async()=>{
  const f=runtimeFixture([p1,p2]),id=await sharedKey(),recipe=(await f.plugin.profile("general")).recipe;
  const remoteResults={[p1.id]:{fingerprint:p1.fingerprint,text:"remote completed page one",recipe,number:1}};
  const remote={output:"Mirror/a.md",desired:[p1,p2],pages:remoteResults};
  const text=buildMarkdown(remote,false);
  f.io.files.set("Mirror/a.md",text);await new PublicationReceipts(f.io).save(id,text,remote.desired,remoteResults);
  await f.plugin.update();
  assert.equal(f.io.files.get("Mirror/a.md"),text);assert.deepEqual(f.calls,[]);
  assert.match(f.plugin.store.notebooks[source].error,/not arrived|synchronization/);
  await f.cache.saveResult({notebookId:id,pageId:p1.id,fingerprint:p1.fingerprint,recipe},remoteResults[p1.id].text);
  await f.plugin.retry();
  assert.deepEqual(f.calls,[2]);
  assert.match(f.io.files.get("Mirror/a.md"),/remote completed page one/);
  assert.match(f.io.files.get("Mirror/a.md"),/recognized 2/);
});
test("runtime accepts its locally known deletions and reordering",async()=>{
  const f=runtimeFixture([p1,p2]);await f.plugin.update();
  f.change([{...p2,number:1},{...p1,number:2}]);await f.plugin.update();
  assert.equal(f.plugin.store.notebooks[source].status,"current");
  const reordered=f.io.files.get("Mirror/a.md");
  assert(reordered.indexOf("recognized 2")<reordered.indexOf("recognized 1"));
  f.change([{...p1,number:1}]);await f.plugin.update();
  assert.equal(f.plugin.store.notebooks[source].status,"current");
  assert(!f.io.files.get("Mirror/a.md").includes("recognized 2"));
  assert.deepEqual(f.calls,[1,2]);
});
test("runtime rechecks received results after token counting and avoids a new paid request",async()=>{
  const f=runtimeFixture(),id=await sharedKey(),resolved=await f.plugin.profile("general");
  const otherDevice=new SharedNotebookCache(f.io,"other-device",{sleep:async()=>{},settleMs:0});
  delete f.plugin.transcribe; // Exercise real runtime admission/accounting with mocked requestUrl.
  f.plugin.apiKey="mock-api-key";
  await f.plugin.saveCostSettings({dailyUsd:10,monthlyUsd:100,runUsd:10,dailyRequests:100,maxOutputTokens:4096,
    prices:[{endpoint:resolved.profile.endpoint,model:resolved.profile.model,input:1,cached:0.1,cacheWrite:1.25,
      output:1,longThreshold:272000,longInputMultiplier:2,longOutputMultiplier:1.5}]});
  let tokenChecks=0,inferenceRequests=0;
  globalThis.__omitUsage=false;
  globalThis.__tokenCount=async()=>{
    tokenChecks++;
    // Sync delivered a successful immutable result, while the other claim is still unseen.
    await otherDevice.saveResult({notebookId:id,pageId:p1.id,fingerprint:p1.fingerprint,recipe:resolved.recipe},"result arrived during token count");
    return {status:200,json:{object:"response.input_tokens",input_tokens:100}};
  };
  globalThis.__response=async()=>{
    inferenceRequests++;
    return {status:200,json:{status:"completed",output:[{type:"message",content:[{type:"output_text",text:"unnecessary new inference"}]}]}};
  };
  try{
    await f.plugin.update();
    assert.equal(tokenChecks,1);
    assert.equal(inferenceRequests,0);
    assert.equal(f.plugin.costs.total.requests,0);
    const state=f.plugin.store.notebooks[source];
    assert.equal(state.status,"current");
    assert.equal(state.pages[p1.id].text,"result arrived during token count");
    assert.match(f.io.files.get(state.output),/result arrived during token count/);
    const persisted=[...f.io.files].filter(([path])=>/\/state-[ab]\.json$/.test(path)).map(([,body])=>JSON.parse(body)).sort((a,b)=>b.generation-a.generation)[0];
    assert.equal(persisted.store.notebooks[source].pages[p1.id].text,"result arrived during token count");
  }finally{globalThis.__tokenCount=undefined;globalThis.__response=undefined;globalThis.__omitUsage=false;}
});
