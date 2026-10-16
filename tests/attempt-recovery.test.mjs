import test from 'node:test';
import assert from 'node:assert/strict';
import {interruptedAttempts} from '../src/attempt-recovery.mjs';
const state=()=>({desired:[{id:'p',number:2,fingerprint:'fp'}],pages:{}});
const row=(extra={})=>({id:'request',source:'note',pageId:'p',fingerprint:'fp',recipe:'recipe',status:'unconfirmed',started:1,...extra});
test('interrupted and completed requests with missing text hold a page without claiming success',()=>{
 for(const status of ['unconfirmed','failed','complete']){
 const x=interruptedAttempts([row({status})],{note:state()});assert.equal(x.pages.length,1);assert.equal(x.pages[0].number,2);assert.equal(x.pages[0].kind,status==='complete'?'lost_result':'interrupted');
 }
});
test('saved result suppresses an uncertain hold, but a still pending force request does not',()=>{
 const s=state();s.pages.p={fingerprint:'fp',recipe:'recipe',text:'paid result'};
 assert.equal(interruptedAttempts([row()],{note:s}).pages.length,0);
 s.forcePending=['p'];assert.equal(interruptedAttempts([row()],{note:s}).pages.length,1);
});
test('edited/deleted pages and existing failed or skipped decisions are not re-held',()=>{
 const s=state();assert.equal(interruptedAttempts([row({fingerprint:'old'})],{note:s}).pages.length,0);
 for(const status of ['failed','skipped']){s.pageIssues={p:{fingerprint:'fp',status}};assert.equal(interruptedAttempts([row()],{note:s}).pages.length,0);}
 assert.equal(interruptedAttempts([row()],{}).pages.length,0);
});
test('latest acknowledged attempt suppresses older requests for that identity',()=>{
 assert.equal(interruptedAttempts([row(),row({id:'new',started:2,acknowledged:true})],{note:state()}).pages.length,0);
 assert.equal(interruptedAttempts([row({acknowledged:true}),row({id:'new',started:2})],{note:state()}).pages.length,1);
});
test('legacy uncertainty holds only its notebook and does not guess the concurrent page',()=>{
 const x=interruptedAttempts([row({pageId:undefined,fingerprint:undefined})],{note:state()});assert.equal(x.pages.length,0);assert.equal(x.legacy.length,1);
 for(const status of ['complete','failed','counted','assumed'])assert.equal(interruptedAttempts([row({fingerprint:undefined,status})],{note:state()}).legacy.length,0);
 assert.equal(interruptedAttempts([row({fingerprint:undefined,acknowledged:true})],{note:state()}).legacy.length,0);
});
test('actionable source and legacy holds do not require a second generated page retry',()=>{
 for(const hold of [{executionIssue:{scope:'source',reason:'model unavailable'}},{legacyPageFailure:'Earlier interrupted request'}]){
 const s={...state(),...hold};const r=interruptedAttempts([row(),row({id:'legacy',fingerprint:undefined})],{note:s});assert.deepEqual(r,{pages:[],legacy:[]});
 }
});
