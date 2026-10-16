import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {attempt,callback,validateIdentity,validateGrant} from '../scripts/subscription-probe/protocol.mjs';
import {completedText,pageRequest,catalogModels,recognizeWithFallback} from '../scripts/subscription-probe/stream.mjs';
const redirect='http://127.0.0.1:19455/auth/callback';
test('catalog accepts both published and standard API shapes without inventing available models',()=>{
 assert.deepEqual(catalogModels({models:[{slug:'gpt-5.6-sol',display_name:'GPT-5.6-Sol',visibility:'list'},{slug:'hidden',visibility:'hidden'}]}),[{slug:'gpt-5.6-sol',name:'GPT-5.6-Sol'}]);
 assert.deepEqual(catalogModels({data:[{id:'gpt-6.1-sol'},{invalid:true}]}),[{slug:'gpt-6.1-sol',name:'gpt-6.1-sol'}]);
 assert.deepEqual(catalogModels({models:[]}),[]);
});
test('subscription authorization uses fresh state/nonce/PKCE and no client secret or API key',()=>{
 const a=attempt('urn:uuid:test',redirect),b=attempt('urn:uuid:test',redirect);
 const u=new URL(a.url);assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');
 assert.equal(u.searchParams.get('resource'),'https://api.openai.com/v1');
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.notEqual(a.pending.state,b.pending.state);assert.notEqual(a.pending.nonce,b.pending.nonce);
 assert(!u.searchParams.has('client_secret'));assert(!a.url.includes(a.pending.verifier));
});
test('callback rejects wrong state, missing/different registration and replay before exchange',()=>{
 const {pending}=attempt('urn:uuid:test',redirect);
 assert.throws(()=>callback(pending,new URLSearchParams({state:'wrong',code:'code',client_id:'oaiapp_test'})));
 const valid=new URLSearchParams({state:pending.state,code:'code',client_id:'oaiapp_test'});
 const exchange=callback(pending,valid);assert.equal(exchange.clientId,'oaiapp_test');
 assert.equal(exchange.body.get('redirect_uri'),redirect);assert.throws(()=>callback(pending,valid));
 const saved=attempt('urn:uuid:test',redirect,'oaiapp_saved').pending;
 assert.throws(()=>callback(saved,new URLSearchParams({state:saved.state,code:'code',client_id:'oaiapp_other'})));
 const missing=attempt('urn:uuid:test',redirect).pending;
 assert.throws(()=>callback(missing,new URLSearchParams({state:missing.state,code:'code'})));
});
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]};
function token(claims){const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url');return `${h}.${p}.${sign('RSA-SHA256',Buffer.from(h+'.'+p),keys.privateKey).toString('base64url')}`;}
test('identity requires valid signature, issued audience, nonce, issuer and expiry',()=>{
 const claims={iss:'https://auth.openai.com',aud:'oaiapp_test',nonce:'nonce',sub:'subject',exp:2000};
 assert.equal(validateIdentity(token(claims),jwks,'oaiapp_test','nonce',1000).sub,'subject');
 for(const bad of [{aud:'other'},{nonce:'wrong'},{iss:'https://elsewhere.test'},{exp:999}]) assert.throws(()=>validateIdentity(token({...claims,...bad}),jwks,'oaiapp_test','nonce',1000));
 const parts=token(claims).split('.');parts[1]=Buffer.from(JSON.stringify({...claims,sub:'attacker'})).toString('base64url');assert.throws(()=>validateIdentity(parts.join('.'),jwks,'oaiapp_test','nonce',1000));
});
test('identity login alone cannot authorize subscription inference',()=>{
 assert.throws(()=>validateGrant({scope:'openid email',access_token:'test',token_type:'Bearer',expires_in:3600}));
 validateGrant({scope:'openid chatgpt.tokens.use.direct',access_token:'test',token_type:'Bearer',expires_in:3600});
});
const event=data=>'data: '+JSON.stringify(data)+'\n\n';
test('stream succeeds only after a completed response and retains token usage',()=>{
 const s=event({type:'response.output_text.delta',delta:'Page text'})+event({type:'response.completed',response:{status:'completed',usage:{input_tokens:10,output_tokens:2}}});
 const result=completedText(s.replace(/\n/g,'\r\n'));assert.equal(result.text,'Page text');assert.equal(result.usage.input_tokens,10);
 assert.throws(()=>completedText(event({type:'response.output_text.delta',delta:'Partial'})+'data: [DONE]\n\n'));
});
test('late subscription limit and incomplete responses never become successful text',()=>{
 const partial=event({type:'response.output_text.delta',delta:'Partial'});
 assert.throws(()=>completedText(partial+event({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}})),/usage_limit_exceeded/);
 assert.throws(()=>completedText(partial+event({type:'response.incomplete'})));
});
test('isolated page request omits unsupported API parameters and allows only the two authorized models',()=>{
 const r=pageRequest('gpt-6.1-sol','data:image/png;base64,AA==','Transcribe faithfully');
 assert.equal(r.store,false);assert.equal(r.stream,true);assert.equal(r.input[0].content[1].type,'input_image');
 for(const key of ['max_output_tokens','temperature','background','previous_response_id','metadata'])assert(!(key in r));
 assert.throws(()=>pageRequest('different-model','data:image/png;base64,AA==',''));
 assert.equal(pageRequest('gpt-5.6-sol','data:image/png;base64,AA==','').model,'gpt-5.6-sol');
 assert.throws(()=>pageRequest('gpt-6.1-sol','https://remote.test/image.png',''));
});
test('direct Sol attempt falls back once for model rejection and never retries quota or incomplete work',async()=>{
 const calls=[];
 const done=event({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:'Page'}]}]}});
 const result=await recognizeWithFallback(async model=>{calls.push(model);return model==='gpt-6.1-sol'?{status:404,error:{code:'model_not_found'}}:{status:200,text:done};});
 assert.deepEqual(calls,['gpt-6.1-sol','gpt-5.6-sol']);assert.equal(result.model,'gpt-5.6-sol');
 for(const response of [{status:429,error:{code:'subscription_sharing_usage_limit_exceeded'}},{status:503},{status:200,text:event({type:'response.incomplete'})}]){
  let count=0;await assert.rejects(recognizeWithFallback(async()=>{count++;return response;}));assert.equal(count,1);
 }
 let count=0;await recognizeWithFallback(async()=>{count++;return {status:200,text:done};});assert.equal(count,1);
});
