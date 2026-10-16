export const ISSUER='https://auth.openai.com';
export const RESOURCE='https://api.openai.com/v1';
export const REDIRECT='http://127.0.0.1:19456/auth/callback';
export const SECRET='nomad-transcripts-subscription-test';
export function encode(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decode(text){const s=atob(text.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
export function random(){return encode(crypto.getRandomValues(new Uint8Array(32)));}
export async function begin(record,now=Date.now()){
 const pending={state:random(),nonce:random(),verifier:random(),created:now,clientId:record.clientId,redirect:REDIRECT};
 const challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pending.verifier)));
 const url=new URL(ISSUER+'/api/accounts/authorize');
 for(const [key,value] of Object.entries({client_id:record.clientId||'dynamic_agent_client',...(!record.clientId?{agent_name_hint:'Supernote Transcripts Nomad Test'}:{}),ext_agent_host_id:record.hostId,response_type:'code',redirect_uri:REDIRECT,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource:RESOURCE,state:pending.state,nonce:pending.nonce,code_challenge_method:'S256',code_challenge:challenge}))url.searchParams.set(key,value);
 return {pending,url:url.href};
}
export function exchangeForm(pending,result,now=Date.now()){
 if(!pending || pending.used || now-pending.created>600000 || result.state!==pending.state)throw Error('Invalid or expired sign-in return');
 if(result.error)throw Error('Sign-in was declined');
 const clientId=result.client_id||pending.clientId;
 if(!clientId || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(clientId) || (pending.clientId && clientId!==pending.clientId) || !result.code)throw Error('Incomplete or mismatched registration');
 pending.used=true;
 return {clientId,body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code:result.code,code_verifier:pending.verifier,redirect_uri:pending.redirect,resource:RESOURCE}).toString()};
}
export async function identity(token,jwks,clientId,nonce,subject,now=Date.now()/1000){
 const parts=token?.split('.');if(parts?.length!==3)throw Error('Invalid identity token');
 const text=b=>new TextDecoder().decode(decode(b));
 const header=JSON.parse(text(parts[0])),claims=JSON.parse(text(parts[1]));
 const jwk=jwks.keys?.find(k=>k.kid===header.kid && k.kty==='RSA' && (!k.alg||k.alg==='RS256') && (!k.use||k.use==='sig'));
 if(header.alg!=='RS256'||!jwk)throw Error('Invalid identity signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('Identity signature validation failed');
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(claims.iss!==ISSUER||!aud.includes(clientId)||(aud.length>1&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf&&claims.nbf>now+30)||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||(subject&&claims.sub!==subject))throw Error('Identity claims validation failed');
 return {subject:claims.sub,email:typeof claims.email==='string'?claims.email:undefined};
}
export function credentials(data,now=Date.now()){
 if(data.token_type?.toLowerCase()!=='bearer'||typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||!data.scope?.split(' ').includes('chatgpt.tokens.use.direct')||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw Error('ChatGPT plan permission or renewable session missing');
 return {accessToken:data.access_token,refreshToken:data.refresh_token,idToken:data.id_token,scope:data.scope,expiresAt:now+data.expires_in*1000,earliestRefreshAt:normalizeRefresh(data.earliest_refresh_at)};
}
function normalizeRefresh(value){if(typeof value==='number')return value<1e12?value*1000:value;return typeof value==='string'?Date.parse(value):0;}
export function refreshForm(record){if(!record.clientId||!record.tokens?.refreshToken)throw Error('Sign in again');return new URLSearchParams({grant_type:'refresh_token',client_id:record.clientId,refresh_token:record.tokens.refreshToken,resource:RESOURCE}).toString();}
