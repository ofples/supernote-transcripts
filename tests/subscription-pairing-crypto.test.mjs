import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  createPairingCode,
  normalizePairingCode,
  sealPairing,
  openPairing,
  pairingAddress,
  validatePairingAuthorization,
} from '../src/subscription-pairing-crypto.mjs';
import { storedSession } from '../src/subscription-auth.mjs';

globalThis.crypto ??= webcrypto;

const sid = 'urn:uuid:123e4567-e89b-42d3-a456-426614174000';
const otherSid = 'urn:uuid:123e4567-e89b-42d3-a456-426614174001';
const code = '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';

test('new pairing code has 96 random bits in a short unambiguous alphabet and old 128-bit codes remain accepted', () => {
  const generated = createPairingCode();
  assert.match(generated, /^(?:[2-9A-HJ-NP-Z]{4}-){4}[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizePairingCode(generated).length, 20);
  assert.equal(normalizePairingCode(code.toLowerCase().replaceAll('-', ' ')), code.replaceAll('-', ''));
  for (const bad of ['', 'abc', 'G'.repeat(32), '0'.repeat(33), '0'.repeat(16) + ' 0'.repeat(8), 'I'.repeat(20), 'A'.repeat(19) + 'B']) {
    assert.throws(() => normalizePairingCode(bad));
  }
});

test('AES-GCM round trip binds code, session, and message purpose', async () => {
  const value = { kind: 'poll-reply', status: 'ready', count: 2 };
  const envelope = await sealPairing(code, sid, 'poll-reply', value);
  assert.deepEqual(Object.keys(envelope).sort(), ['data', 'iv', 'sid', 'v']);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.sid, sid);
  assert.deepEqual(await openPairing(code, sid, 'poll-reply', envelope), value);
  await assert.rejects(openPairing('FFFF-'.repeat(6) + 'FFFF', sid, 'poll-reply', envelope));
  await assert.rejects(openPairing(code, otherSid, 'poll-reply', envelope));
  await assert.rejects(openPairing(code, sid, 'poll', envelope));
});

test('short codes derive the same AES-GCM key on both peers', async () => {
  const shortCode = createPairingCode();
  const envelope = await sealPairing(shortCode, sid, 'poll', { op: 'poll' });
  assert.deepEqual(await openPairing(shortCode.replaceAll('-', ''), sid, 'poll', envelope), { op: 'poll' });
  await assert.rejects(openPairing(createPairingCode(), sid, 'poll', envelope));
});

test('tampering, malformed envelopes, invalid purposes, and oversized data fail closed', async () => {
  const envelope = await sealPairing(code, sid, 'request', { hello: 'world' });
  const modified = { ...envelope, data: `${envelope.data.slice(0, -1)}${envelope.data.endsWith('A') ? 'B' : 'A'}` };
  await assert.rejects(openPairing(code, sid, 'request', modified));
  await assert.rejects(openPairing(code, sid, 'request', { ...envelope, sid: otherSid }));
  await assert.rejects(openPairing(code, sid, 'request', { ...envelope, extra: true }));
  await assert.rejects(sealPairing(code, sid, 'authorization', {}));
  await assert.rejects(openPairing(code, sid, 'ack', envelope));
  await assert.rejects(sealPairing(code, sid, 'ack', []));
  await assert.rejects(sealPairing(code, sid, 'ack', { payload: 'x'.repeat(33 * 1024) }));
  await assert.rejects(openPairing(code, sid, 'request', { ...envelope, iv: 'AA' }));
  await assert.rejects(openPairing(code, sid, 'request', { ...envelope, data: 'A'.repeat(43713) }));
});

test('pairing address accepts only RFC1918 IPv4 on the fixed HTTP port', () => {
  for (const address of ['http://10.0.0.2:19457', 'http://172.16.10.8:19457/', 'http://172.31.255.254:19457', 'http://192.168.1.12:19457']) {
    assert.match(pairingAddress(address), /^http:\/\/(?:10\.|172\.|192\.168\.)/);
  }
  for (const address of [
    'https://192.168.1.12:19457', 'http://8.8.8.8:19457', 'http://172.32.1.2:19457',
    'http://192.169.1.2:19457', 'http://127.0.0.1:19457', 'http://localhost:19457',
    'http://10.0.0.2:19456', 'http://10.0.0.2:19457/path', 'http://user@10.0.0.2:19457',
    'http://10.0.0.2:19457/?token=x', 'http://010.0.0.2:19457', 'http://10.0.0.999:19457',
  ]) assert.throws(() => pairingAddress(address), undefined, address);
});

function authorizationUrl({ clientId = 'oaiapp_testRegistration_123', dynamic = false } = {}) {
  const params = new URLSearchParams({
    client_id: dynamic ? 'dynamic_agent_client' : clientId,
    ...(dynamic ? { agent_name_hint: 'Supernote Transcripts' } : {}),
    ext_agent_host_id: sid,
    response_type: 'code',
    redirect_uri: 'http://127.0.0.1:19456/auth/callback',
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource: 'https://api.openai.com/v1',
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge_method: 'S256',
    code_challenge: 'c'.repeat(43),
  });
  return `https://auth.openai.com/api/accounts/authorize?${params}`;
}

test('authorization URL validator accepts exact registered and first-registration flows', () => {
  const registered = validatePairingAuthorization(authorizationUrl());
  assert.equal(registered.state, 's'.repeat(43));
  assert.equal(registered.clientId, 'oaiapp_testRegistration_123');
  assert.equal(validatePairingAuthorization(authorizationUrl({ dynamic: true })).clientId, 'dynamic_agent_client');
});

test('authorization URL validator rejects injection, duplicate parameters, and unsafe flow changes', () => {
  const good = authorizationUrl();
  const badUrls = [
    good.replace('auth.openai.com', 'auth.openai.com.attacker.example'),
    good.replace('/api/accounts/authorize', '/api/accounts/authorize/extra'),
    `${good}&redirect_uri=https://attacker.example/callback`,
    `${good}&prompt=login`,
    good.replace('response_type=code', 'response_type=token'),
    good.replace('code_challenge_method=S256', 'code_challenge_method=plain'),
    good.replace('ext_agent_host_id=urn%3Auuid%3A123e4567-e89b-42d3-a456-426614174000', 'ext_agent_host_id=not-a-uuid'),
    good.replace('client_id=oaiapp_testRegistration_123', 'client_id=dynamic_agent_client'),
    `${good}#fragment`,
  ];
  for (const url of badUrls) assert.throws(() => validatePairingAuthorization(url), undefined, url);
  assert.throws(() => validatePairingAuthorization('https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client'));
});

test('saved pairing validation accepts canonical pending state and rejects unsafe fields', () => {
  const session = pairingSession();
  assert.equal(storedSession(session), session);
  assert.throws(() => storedSession(pairingSession({ address: 'http://8.8.8.8:19457' })));
  assert.throws(() => storedSession(pairingSession({ code: 'A'.repeat(31) })));
  assert.throws(() => storedSession(pairingSession({ expiresAt: 601001 })));
});

function pairingSession(overrides = {}) {
  return {
    hostId: sid,
    pending: {
      state: 's'.repeat(43),
      nonce: 'n'.repeat(43),
      verifier: 'v'.repeat(43),
      redirect: 'http://127.0.0.1:19456/auth/callback',
      created: 1000,
      pairing: {
        address: 'http://192.168.1.12:19457',
        code: '0123456789ABCDEF0123456789ABCDEF',
        sid: otherSid,
        expiresAt: 2000,
        ...overrides,
      },
    },
  };
}
