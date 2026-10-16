import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {begin,exchangeForm,identity,credentials,refreshForm,REDIRECT} from '../scripts/subscription-nomad/auth.mjs';
test('Nomad login owns distinct host, loopback callback and fresh WebCrypto PKCE',async()=>{
 const a=await begin({hostId:'urn:uuid:nomad'}),b=await begin({hostId:'urn:uuid:nomad'});
 const u=new URL(a.url);assert.equal(u.searchParams.get('redirect_uri'),REDIRECT);assert.equal(u.searchParams.get('ext_agent_host_id'),'urn:uuid:nomad');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(a.pending.state.length,43);assert.notEqual(a.pending.state,b.pending.state);
 const returning=await begin({hostId:'nomad',clientId:'oaiapp_saved'});assert.equal(new URL(returning.url).searchParams.get('client_id'),'oaiapp_saved');assert(!new URL(returning.url).searchParams.has('agent_name_hint'));
});
test('Nomad code exchange rejects stale, replayed and mismatched returns',async()=>{
 const {pending}=await begin({hostId:'nomad'},1000);
 assert.throws(()=>exchangeForm(pending,{state:'other',code:'x',client_id:'oaiapp_test'},1001));
 assert.throws(()=>exchangeForm({...pending},{state:pending.state,code:'x',client_id:'oaiapp_test'},601001));
 const form=exchangeForm(pending,{state:pending.state,code:'x',client_id:'oaiapp_test'},1001);assert.equal(new URLSearchParams(form.body).get('redirect_uri'),REDIRECT);assert.throws(()=>exchangeForm(pending,{state:pending.state,code:'x',client_id:'oaiapp_test'},1001));
 const p=(await begin({hostId:'nomad',clientId:'oaiapp_saved'},1000)).pending;
 assert.throws(()=>exchangeForm(p,{state:p.state,code:'x',client_id:'oaiapp_other'},1001));
});
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]};
function jwt(claims){const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),keys.privateKey).toString('base64url');}
test('Nomad WebCrypto validates signatures and binds nonce, registration and existing identity',async()=>{
 const c={iss:'https://auth.openai.com',aud:'oaiapp_test',nonce:'test',sub:'subject',exp:2000,email:'test@example.com'};
 assert.deepEqual(await identity(jwt(c),jwks,'oaiapp_test','test','subject',1000),{subject:'subject',email:'test@example.com'});
 for(const change of [{aud:'other'},{nonce:'other'},{iss:'https://wrong'},{exp:900}])await assert.rejects(identity(jwt({...c,...change}),jwks,'oaiapp_test','test','subject',1000));
 await assert.rejects(identity(jwt(c),jwks,'oaiapp_test','test','different',1000));
 const parts=jwt(c).split('.');parts[1]=Buffer.from(JSON.stringify({...c,sub:'attacker'})).toString('base64url');await assert.rejects(identity(parts.join('.'),jwks,'oaiapp_test','test',undefined,1000));
});
test('renewal requires a rotating refresh token and plan scope, preserving server earliest refresh',()=>{
 const data={access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope:'openid chatgpt.tokens.use.direct',earliest_refresh_at:2000};
 const tokens=credentials(data,1000);assert.equal(tokens.expiresAt,3601000);assert.equal(tokens.earliestRefreshAt,2000000);
 const r=new URLSearchParams(refreshForm({clientId:'oaiapp_test',tokens}));assert.equal(r.get('client_id'),'oaiapp_test');assert.equal(r.get('refresh_token'),'refresh');assert(!r.has('scope'));
 for(const bad of [{scope:'openid'},{refresh_token:undefined},{expires_in:-1},{token_type:'other'}])assert.throws(()=>credentials({...data,...bad}));
});
