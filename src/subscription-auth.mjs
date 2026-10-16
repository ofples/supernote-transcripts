import { normalizePairingCode, pairingAddress } from './subscription-pairing-crypto.mjs';
export const ISSUER='https://auth.openai.com';
export const RESOURCE='https://api.openai.com/v1';
export const REDIRECT='http://127.0.0.1:19456/auth/callback';
export const SECRET='nomad-transcripts-chatgpt-session';
export function encode(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decode(text){const s=atob(text.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
export function random(){return encode(crypto.getRandomValues(new Uint8Array(32)));}
export async function begin(record,now=Date.now()){
 const pending={state:random(),nonce:random(),verifier:random(),created:now,clientId:record.clientId,redirect:REDIRECT};
 const challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pending.verifier)));
 const url=new URL(ISSUER+'/api/accounts/authorize');
 for(const [key,value] of Object.entries({client_id:record.clientId||'dynamic_agent_client',...(!record.clientId?{agent_name_hint:'Supernote Transcripts'}:{}),ext_agent_host_id:record.hostId,response_type:'code',redirect_uri:REDIRECT,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource:RESOURCE,state:pending.state,nonce:pending.nonce,code_challenge_method:'S256',code_challenge:challenge}))url.searchParams.set(key,value);
 return {pending,url:url.href};
}
export function exchangeForm(pending,result,now=Date.now()){
 if(!pending || !result || pending.used || !Number.isFinite(pending.created) || now<pending.created || now-pending.created>600000 || result.state!==pending.state || pending.redirect!==REDIRECT)throw Error('Invalid or expired sign-in return');
 if(result.error)throw Error('Sign-in was declined');
 const clientId=result.client_id||pending.clientId;
 if(typeof clientId!=='string' || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(clientId) || (pending.clientId && clientId!==pending.clientId) || typeof result.code!=='string' || !result.code)throw Error('Incomplete or mismatched registration');
 pending.used=true;
 return {clientId,body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code:result.code,code_verifier:pending.verifier,redirect_uri:pending.redirect,resource:RESOURCE}).toString()};
}
export async function identity(token,jwks,clientId,nonce,subject,now=Date.now()/1000){
 const parts=typeof token==='string'?token.split('.'):[];if(parts.length!==3)throw Error('Invalid identity token');
 const text=b=>new TextDecoder().decode(decode(b));
 const header=JSON.parse(text(parts[0])),claims=JSON.parse(text(parts[1]));
 const candidates=Array.isArray(jwks?.keys)?jwks.keys.filter(k=>k?.kid===header.kid && k.kty==='RSA' && (!k.alg||k.alg==='RS256') && (!k.use||k.use==='sig')):[];
 const jwk=candidates.length===1?candidates[0]:undefined;
 if(header.alg!=='RS256'||!jwk)throw Error('Invalid identity signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('Identity signature validation failed');
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(claims.iss!==ISSUER||!aud.includes(clientId)||(aud.length>1&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+30))||(nonce!==undefined&&claims.nonce!==nonce)||typeof claims.sub!=='string'||!claims.sub||(subject&&claims.sub!==subject))throw Error('Identity claims validation failed');
 return {subject:claims.sub,email:typeof claims.email==='string'?claims.email:undefined};
}
export function credentials(data,now=Date.now()){
 if(!data||typeof data.token_type!=='string'||data.token_type.toLowerCase()!=='bearer'||typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||typeof data.scope!=='string'||!data.scope.split(' ').includes('chatgpt.tokens.use.direct')||!Number.isFinite(data.expires_in)||data.expires_in<=0||!Number.isFinite(now+data.expires_in*1000))throw Error('ChatGPT plan permission or renewable session missing');
 const earliestRefreshAt=normalizeRefresh(data.earliest_refresh_at);
 if(!Number.isFinite(earliestRefreshAt)||earliestRefreshAt<0)throw Error('Invalid session renewal time');
 return {accessToken:data.access_token,refreshToken:data.refresh_token,idToken:data.id_token,scope:data.scope,expiresAt:now+data.expires_in*1000,earliestRefreshAt};
}
function normalizeRefresh(value){if(value===undefined||value===null)return 0;if(typeof value==='number')return value<1e12?value*1000:value;return typeof value==='string'?Date.parse(value):NaN;}
export function refreshForm(record){if(!record.clientId||!record.tokens?.refreshToken)throw Error('Sign in again');return new URLSearchParams({grant_type:'refresh_token',client_id:record.clientId,refresh_token:record.tokens.refreshToken,resource:RESOURCE}).toString();}

export function storedSession(value) {
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.hostId!=='string'||!/^urn:uuid:[a-f0-9-]{36}$/i.test(value.hostId))throw Error('Saved ChatGPT session is invalid. Disconnect it before signing in again.');
 if(value.clientId!==undefined&&(typeof value.clientId!=='string'||!/^oaiapp_[a-zA-Z0-9_-]+$/.test(value.clientId)))throw Error('Invalid saved registration');
 if(value.subject!==undefined&&(typeof value.subject!=='string'||!value.subject))throw Error('Invalid saved identity');
 if(value.email!==undefined&&typeof value.email!=='string')throw Error('Invalid saved email');
 if(value.renewalBlocked!==undefined&&typeof value.renewalBlocked!=='boolean')throw Error('Invalid saved renewal state');
 const t=value.tokens;
 if(t&&(!value.clientId||!value.subject||typeof t.accessToken!=='string'||!t.accessToken||typeof t.refreshToken!=='string'||!t.refreshToken||typeof t.scope!=='string'||!t.scope.split(' ').includes('chatgpt.tokens.use.direct')||!Number.isFinite(t.expiresAt)||t.expiresAt<=0||!Number.isFinite(t.earliestRefreshAt)||t.earliestRefreshAt<0))throw Error('Invalid saved renewable session');
 if(value.tokens!==undefined&&!t)throw Error('Invalid saved tokens');
 const p=value.pending;
 if(p&&(![p.state,p.nonce,p.verifier].every(s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s))||p.redirect!==REDIRECT||!Number.isFinite(p.created)||p.created<0||(p.used!==undefined&&typeof p.used!=='boolean')||(p.clientId!==undefined&&p.clientId!==value.clientId)))throw Error('Invalid saved sign-in attempt');
 if(value.pending!==undefined&&!p)throw Error('Invalid saved sign-in attempt');
 if(p?.pairing){
  const b=p.pairing;
  if(typeof b!=='object'||Array.isArray(b)||pairingAddress(b.address)!==b.address||normalizePairingCode(b.code)!==b.code||typeof b.sid!=='string'||!/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.sid)||!Number.isFinite(b.expiresAt)||b.expiresAt<=p.created||b.expiresAt>p.created+600000)throw Error('Invalid saved desktop pairing');
 }
 if(p?.pairing!==undefined&&!p.pairing)throw Error('Invalid saved desktop pairing');
 return value;
}
