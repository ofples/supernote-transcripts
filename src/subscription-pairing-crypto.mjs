const PAIRING_CONTEXT = 'supernote-transcripts-pairing-v1';
const PAIRING_SALT_TEXT = 'supernote-transcripts-pairing-v1';
const MAX_PLAINTEXT_BYTES = 32 * 1024;
const PURPOSES = new Set([
  'request', 'request-reply', 'poll', 'poll-reply', 'ack', 'ack-reply',
]);
const REDIRECT = 'http://127.0.0.1:19456/auth/callback';
const RESOURCE = 'https://api.openai.com/v1';
const REQUIRED_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

function webCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto is unavailable');
  }
  return globalThis.crypto;
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    throw new Error('Invalid pairing session ID');
  }
}

function assertPurpose(purpose) {
  if (!PURPOSES.has(purpose)) throw new Error('Invalid pairing message purpose');
}

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(text, expectedLength, maximumLength) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid encrypted pairing data');
  const maximumEncodedLength = Math.ceil((expectedLength ?? maximumLength) * 4 / 3);
  if (text.length > maximumEncodedLength || (expectedLength !== undefined && text.length !== maximumEncodedLength)) {
    throw new Error('Invalid encrypted pairing data');
  }
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (base64url(bytes) !== text || (expectedLength !== undefined && bytes.length !== expectedLength)
    || (maximumLength !== undefined && bytes.length > maximumLength)) {
    throw new Error('Invalid encrypted pairing data');
  }
  return bytes;
}

function keyBytes(code) {
  const normalized = normalizePairingCode(code);
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
}

async function deriveKey(code, sessionId) {
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey('raw', keyBytes(code), 'HKDF', false, ['deriveKey']);
  const salt = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PAIRING_SALT_TEXT));
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(sessionId) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aad(purpose, sessionId) {
  return new TextEncoder().encode(`${PAIRING_CONTEXT}|${purpose}|${sessionId}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function createPairingCode() {
  const bytes = webCrypto().getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g).join('-');
}

export function normalizePairingCode(value) {
  if (typeof value !== 'string') throw new Error('Invalid pairing code');
  const normalized = value.replace(/[ -]/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(normalized)) throw new Error('Invalid pairing code');
  return normalized;
}

export async function sealPairing(code, sessionId, purpose, value) {
  assertSessionId(sessionId);
  assertPurpose(purpose);
  if (!isPlainObject(value)) throw new Error('Pairing message must be an object');
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Pairing message is too large');
  const iv = webCrypto().getRandomValues(new Uint8Array(12));
  const ciphertext = await webCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(purpose, sessionId), tagLength: 128 },
    await deriveKey(code, sessionId),
    plaintext,
  );
  return { v: 1, sid: sessionId, iv: base64url(iv), data: base64url(new Uint8Array(ciphertext)) };
}

export async function openPairing(code, sessionId, purpose, envelope) {
  assertSessionId(sessionId);
  assertPurpose(purpose);
  if (!isPlainObject(envelope) || Object.keys(envelope).length !== 4
    || envelope.v !== 1 || envelope.sid !== sessionId) {
    throw new Error('Invalid pairing envelope');
  }
  const iv = fromBase64url(envelope.iv, 12);
  const ciphertext = fromBase64url(envelope.data, undefined, MAX_PLAINTEXT_BYTES + 16);
  if (ciphertext.length < 16) throw new Error('Invalid encrypted pairing data');
  let plaintext;
  try {
    plaintext = await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(purpose, sessionId), tagLength: 128 },
      await deriveKey(code, sessionId),
      ciphertext,
    );
  } catch {
    throw new Error('Pairing authentication failed');
  }
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new Error('Pairing message is too large');
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new Error('Invalid pairing message');
  }
  if (!isPlainObject(value)) throw new Error('Pairing message must be an object');
  return value;
}

export function pairingAddress(value) {
  if (typeof value !== 'string') throw new Error('Invalid pairing address');
  const match = /^http:\/\/(0|[1-9]\d{0,2})(?:\.(0|[1-9]\d{0,2})){3}:19457\/?$/.exec(value);
  if (!match) throw new Error('Pairing address must be an HTTP private IPv4 address on port 19457');
  const host = value.slice('http://'.length).split(':')[0];
  const octets = host.split('.').map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) throw new Error('Invalid pairing IPv4 address');
  const [a, b] = octets;
  const privateAddress = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!privateAddress) throw new Error('Pairing address must use RFC1918 private IPv4');
  return `http://${octets.join('.')}:19457`;
}

export function validatePairingAuthorization(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid authorization URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port
    || url.username || url.password || url.pathname !== '/api/accounts/authorize' || url.hash) {
    throw new Error('Unexpected authorization URL origin or path');
  }
  const entries = [...url.searchParams.entries()];
  const allowed = new Set([
    'client_id', 'agent_name_hint', 'ext_agent_host_id', 'response_type', 'redirect_uri',
    'scope', 'resource', 'state', 'nonce', 'code_challenge_method', 'code_challenge',
  ]);
  const params = new Map();
  for (const [key, val] of entries) {
    if (!allowed.has(key) || params.has(key)) throw new Error('Unexpected or duplicate authorization parameter');
    params.set(key, val);
  }
  const clientId = params.get('client_id');
  const dynamic = clientId === 'dynamic_agent_client';
  const expectedKeys = new Set([
    'client_id', 'ext_agent_host_id', 'response_type', 'redirect_uri', 'scope', 'resource',
    'state', 'nonce', 'code_challenge_method', 'code_challenge',
    ...(dynamic ? ['agent_name_hint'] : []),
  ]);
  if (params.size !== expectedKeys.size || [...params.keys()].some(key => !expectedKeys.has(key))) {
    throw new Error('Incomplete authorization parameters');
  }
  if (!(dynamic || /^oaiapp_[A-Za-z0-9_-]+$/.test(clientId || ''))
    || (dynamic && params.get('agent_name_hint') !== 'Supernote Transcripts')
    || params.get('ext_agent_host_id') === undefined
    || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get('ext_agent_host_id'))
    || params.get('response_type') !== 'code'
    || params.get('redirect_uri') !== REDIRECT
    || params.get('resource') !== RESOURCE
    || params.get('scope') !== REQUIRED_SCOPES
    || params.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43}$/.test(params.get('state') || '')
    || !/^[A-Za-z0-9_-]{43}$/.test(params.get('nonce') || '')
    || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') || '')) {
    throw new Error('Authorization URL does not match the expected sign-in flow');
  }
  return { url: url.href, state: params.get('state'), clientId };
}
