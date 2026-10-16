import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['src/publication-cache.ts'],outfile:'test-artifacts/publication-cache-test.mjs',bundle:true,format:'esm',platform:'node'});
const {hydratePublicationCache}=await import('../test-artifacts/publication-cache-test.mjs');
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const id='a'.repeat(64),recipe='b'.repeat(64),other='c'.repeat(64);
const current=[{id:'p1',number:1,fingerprint:'new1'},{id:'p2',number:2,fingerprint:'new2'}];
async function fixture(){
 const results=await Promise.all(current.map(async p=>({notebookId:id,pageId:p.id,fingerprint:p.fingerprint,recipe,text:`raw ${p.id}`,textHash:await hash(`raw ${p.id}`),recognition:{provider:'subscription',model:'old-model',quality:'careful',recognizedAt:'2026-01-01',promptHash:id,glossaryHash:id}})));
 const receipt={version:2,notebookId:id,textHash:await hash('cleaned output'),pages:current,results:results.map(r=>({id:r.pageId,fingerprint:r.fingerprint,recipe:r.recipe,textHash:r.textHash})),createdAt:1,supersedes:[],recordId:id};
 const queries=[];
 return {receipt,notebookId:id,current,before:[],local:{},queries,results,cache:{findResult:async q=>{queries.push(q);return {chosen:results.find(r=>r.pageId===q.pageId&&r.recipe===q.recipe),alternatives:[],invalidRecords:0};}}};
}
test('hydrates receipt proven raw mixed recipes and retains recognition metadata',async()=>{
 const f=await fixture();f.results[1].recipe=other;f.receipt.results[1].recipe=other;
 const additions=await hydratePublicationCache(f);
 assert.deepEqual(Object.keys(additions),['p1','p2']);assert.equal(additions.p1.text,'raw p1');
 assert.equal(additions.p2.recipe,other);assert.equal(additions.p1.recognition.model,'old-model');
 assert.deepEqual(f.local,{});assert.deepEqual(f.queries.map(q=>q.recipe),[recipe,other]);
});
test('selects exact receipt text from cache alternatives',async()=>{
 const f=await fixture();f.cache.findResult=async q=>({chosen:{...f.results[0],text:'different',textHash:await hash('different')},alternatives:f.results.filter(r=>r.pageId===q.pageId),invalidRecords:0});
 assert.equal((await hydratePublicationCache(f)).p1.text,'raw p1');
});
test('preserves current local divergent text and refuses incomplete adoption atomically',async()=>{
 const f=await fixture();f.local.p1={fingerprint:'new1',text:'personal local result',recipe,number:1};
 assert.deepEqual(await hydratePublicationCache(f),{});assert.equal(f.local.p1.text,'personal local result');
 const missing=await fixture();missing.results.pop();assert.deepEqual(await hydratePublicationCache(missing),{});assert.deepEqual(missing.local,{});
});
test('replaces stale local only when received fingerprint is locally observed',async()=>{
 const f=await fixture();f.local.p1={fingerprint:'old',text:'stale',recipe,number:1};
 assert.equal((await hydratePublicationCache(f)).p1.text,'raw p1');
 f.current=[{...current[0],fingerprint:'unobserved'},current[1]];
 assert.deepEqual(await hydratePublicationCache(f),{});
});
test('rejects incompatible inventory and conflicting concurrent receipt provenance',async()=>{
 const f=await fixture();f.receipt.candidates=[f.receipt,{...f.receipt,results:[{...f.receipt.results[0],recipe:other}]}];
 assert.deepEqual(await hydratePublicationCache(f),{});
 delete f.receipt.candidates;f.receipt.pages=[current[1],current[0]];assert.deepEqual(await hydratePublicationCache(f),{});
});
test('missing receipt, wrong identity and tampered cache text never hydrate',async()=>{
 const f=await fixture();assert.deepEqual(await hydratePublicationCache({...f,receipt:undefined}),{});
 assert.deepEqual(await hydratePublicationCache({...f,notebookId:other}),{});
 f.results[1].text='tampered';assert.deepEqual(await hydratePublicationCache(f),{});
});
test('cache failure cannot mutate caller local results',async()=>{
 const f=await fixture();f.cache.findResult=async q=>{if(q.pageId==='p2')throw Error('Sync read failure');return {chosen:f.results[0],alternatives:[],invalidRecords:0};};
 await assert.rejects(hydratePublicationCache(f),/Sync read failure/);assert.deepEqual(f.local,{});
});
