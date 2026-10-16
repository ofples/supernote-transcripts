import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';

export const RESOURCE = 'https://api.openai.com/v1';
export const ISSUER = 'https://auth.openai.com';
export const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const random = () => randomBytes(32).toString('base64url');
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function attempt(hostId, redirect, savedClient) {
  const pending = {state: random(), nonce: random(), verifier: random(), redirect, clientId: savedClient, created: Date.now()};
  const u = new URL(`${ISSUER}/api/accounts/authorize`);
  for (const [k,v] of Object.entries({client_id: savedClient || 'dynamic_agent_client',
    ...(savedClient ? {} : {agent_name_hint: 'Supernote Transcripts Subscription Test'}),
    ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirect,
    scope: SCOPE, resource: RESOURCE, state: pending.state, nonce: pending.nonce,
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(pending.verifier).digest('base64url')})) u.searchParams.set(k,v);
  return {pending, url: u.href};
}
export function callback(pending, params) {
  if (!pending || pending.used || Date.now() - pending.created > 600000 || !equal(params.get('state'),pending.state)) throw Error('Invalid or expired sign-in callback');
  pending.used = true;
  if (params.get('error')) throw Error('Sign-in was declined or unavailable');
  const issued = params.get('client_id') || pending.clientId;
  if (!issued || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(issued) || (pending.clientId && issued !== pending.clientId) || !params.get('code')) throw Error('Incomplete or mismatched client registration');
  return {clientId: issued, body: new URLSearchParams({grant_type:'authorization_code', client_id:issued, code:params.get('code'), code_verifier:pending.verifier, redirect_uri:pending.redirect, resource:RESOURCE})};
}
export function validateIdentity(token, jwks, clientId, nonce, now = Date.now()/1000) {
  const parts = token?.split('.');
  if (parts?.length !== 3) throw Error('Invalid identity token');
  const head = JSON.parse(Buffer.from(parts[0],'base64url'));
  const claims = JSON.parse(Buffer.from(parts[1],'base64url'));
  const jwk = jwks.keys?.find(k => k.kid === head.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (head.alg !== 'RS256' || !jwk || !verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), createPublicKey({key:jwk,format:'jwk'}), Buffer.from(parts[2],'base64url'))) throw Error('Identity signature validation failed');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now + 30) || !equal(claims.nonce,nonce) || typeof claims.sub !== 'string' || !claims.sub) throw Error('Identity claims validation failed');
  return claims;
}
export function validateGrant(data) {
  if (!data.scope?.split(' ').includes('chatgpt.tokens.use.direct') || data.token_type?.toLowerCase() !== 'bearer' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw Error('ChatGPT plan permission was not granted');
}
