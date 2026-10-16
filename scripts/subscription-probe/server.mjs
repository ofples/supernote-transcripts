import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {catalogModels} from './stream.mjs';
import {attempt,callback,validateIdentity,validateGrant,random,equal,RESOURCE,ISSUER} from './protocol.mjs';

const port=19455, root=new URL('../../private/subscription-probe/',import.meta.url);
await mkdir(root,{recursive:true});
let registration;
try { registration=JSON.parse(await readFile(new URL('registration.json',root),'utf8')); } catch {registration={hostId:`urn:uuid:${randomUUID()}`};}
await writeFile(new URL('registration.json',root),JSON.stringify(registration),{mode:0o600});
const secret=random(), formNonce=random();
// Temporary local bridge credential only. No OAuth credentials are written.
await writeFile(new URL('control.json',root),JSON.stringify({port,secret}),{mode:0o600});
let pending, authorization, credentials, busy=false, leased=false, state='Ready to sign in', closing=false;
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
const discovery=await (await fetch(`${ISSUER}/.well-known/openid-configuration`)).json();
if(discovery.issuer!==ISSUER || !discovery.jwks_uri?.startsWith(`${ISSUER}/`) || !discovery.revocation_endpoint?.startsWith(`${ISSUER}/`)) throw Error('Invalid OpenAI discovery');
async function endSession() {
  if(closing)return;closing=true;
  if(credentials?.refresh_token) {
    try { const r=await fetch(discovery.revocation_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:credentials.refresh_token,token_type_hint:'refresh_token',client_id:registration.clientId}),signal:AbortSignal.timeout(15000)});if(!r.ok)console.log('Session revocation was not confirmed'); } catch {console.log('Session revocation was not confirmed');}
  }
  credentials=undefined;pending=undefined;authorization=undefined;
  await unlink(new URL('control.json',root)).catch(()=>{});
  server.close();
}
const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
  if(req.headers.host!==`127.0.0.1:${port}`){json(res,{error:'Invalid host'},403);return;}
  const u=new URL(req.url,`http://127.0.0.1:${port}`);
  try {
    if(u.pathname==='/' && req.method==='GET') {
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://127.0.0.1:19455 https://auth.openai.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
      res.end('<!doctype html><title>Supernote subscription test</title><style>body{font:20px system-ui;max-width:680px;margin:60px auto;padding:20px}button{font:inherit;padding:12px;background:white;border:1px solid black}</style><h1>Supernote subscription test</h1><p>'+state+'</p><p>This isolated test uses your ChatGPT plan. It does not use an API key or update your transcripts. OAuth credentials remain in memory until the test ends.</p><form method="post" action="/continue"><input type="hidden" name="csrf" value="'+formNonce+'"><button>Continue with ChatGPT</button></form><p>When offered usage controls, disable credit use and choose a small plan allowance for this test.</p>');return;
    }
    if(u.pathname==='/continue' && req.method==='POST') {
      let form='';for await(const chunk of req){form+=chunk.toString('utf8');if(form.length>4096)throw Error('Invalid local sign-in form');}
      if(!equal(new URLSearchParams(form).get('csrf'),formNonce) || (req.headers.origin && req.headers.origin!=='null' && req.headers.origin!==`http://127.0.0.1:${port}`))throw Error('Sign-in must start from the local test page');
      if(credentials)throw Error('Already connected');
      if(!pending || pending.used) {const a=attempt(registration.hostId,`http://127.0.0.1:${port}/auth/callback`,registration.clientId);pending=a.pending;authorization=a.url;}
      state='Waiting for browser sign-in';res.writeHead(303,{location:authorization});res.end();return;
    }
    if(u.pathname==='/auth/callback' && req.method==='GET') {
      if(busy)throw Error('Sign-in already processing');
      busy=true;
      try {
        const exchange=callback(pending,u.searchParams);
        const response=await fetch(`${ISSUER}/api/accounts/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:exchange.body,signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Error(`OAuth exchange failed with HTTP ${response.status}`);
        const tokens=await response.json();
        const keys=await (await fetch(discovery.jwks_uri)).json();
        const identity=validateIdentity(tokens.id_token,keys,exchange.clientId,pending.nonce);
        if(registration.subject && identity.sub!==registration.subject)throw Error('Different account: start a separate registration');
        validateGrant(tokens);
        registration={...registration,clientId:exchange.clientId,subject:identity.sub};
        await writeFile(new URL('registration.json',root),JSON.stringify(registration),{mode:0o600});
        credentials={...tokens,expiresAt:Date.now()+tokens.expires_in*1000};
        state='Connected: ChatGPT plan permission verified';
        res.writeHead(303,{location:'/'});res.end();console.log('ChatGPT plan permission verified. No inference requests made.');
      } finally {busy=false;}
      return;
    }
    if(!equal(req.headers['x-probe-secret'],secret) || req.headers.origin) {json(res,{error:'Forbidden'},403);return;}
    if(u.pathname==='/status' && req.method==='GET') {json(res,{state,connected:!!credentials,leased,credentialStorage:'memory',apiFallback:false});return;}
    if(u.pathname==='/models' && req.method==='GET') {
      if(!credentials)throw Error('Sign in first');
      const r=await fetch(RESOURCE+'/models',{headers:{Authorization:'Bearer '+credentials.access_token},signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error(`Subscription model discovery HTTP ${r.status}`);
      const catalog=await r.json();json(res,{keys:Object.keys(catalog),models:catalogModels(catalog)});return;
    }
    if(u.pathname==='/lease' && req.method==='POST') {
      if(leased || !credentials || credentials.expiresAt < Date.now()+120000)throw Error('No fresh single-use subscription credential available');
      leased=true;json(res,{accessToken:credentials.access_token,expiresAt:credentials.expiresAt,scope:credentials.scope});return;
    }
    if(u.pathname==='/shutdown' && req.method==='POST') {json(res,{ending:true});void endSession();return;}
    json(res,{error:'Unknown test action'},404);
  } catch(e) {
    state='Test stopped: '+(e.message || 'Request failed');
    json(res,{error:state},400);
    console.log('Isolated test stopped. Inspect the local page; no credentials were logged.');
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`Subscription test ready at http://127.0.0.1:${port}/ ; memory-only credentials; no API-key route.`));
server.on('error',()=>{void endSession();});
const timer=setTimeout(()=>{console.log('Test session timed out');void endSession();},25*60*1000);timer.unref();
process.on('SIGINT',()=>void endSession());process.on('SIGTERM',()=>void endSession());
