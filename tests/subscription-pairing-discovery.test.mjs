import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/subscription-pairing-discovery.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { advertise, discover } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const sid = 'urn:uuid:123e4567-e89b-42d3-a456-426614174000';
const publisher = '223e4567-e89b-42d3-a456-426614174002';
const address = 'http://192.168.1.12:19457';
const expiry = 600_000;

function sharedIO(initial = {}) {
  const files = new Map(Object.entries(initial));
  const io = {
    async exists(path) { return path === '' || [...files.keys()].some(key => key === path || key.startsWith(`${path}/`)); },
    async read(path) { if (!files.has(path)) throw Error('missing'); return files.get(path); },
    async write(path, text) { files.set(path, text); },
    async create(path, text) { if (files.has(path)) throw Error('exists'); files.set(path, text); },
    async list(path) { return { files: [...files.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).sort(), folders: [] }; },
    async mkdir() {},
  };
  return { io, files };
}

test('advertise writes only the expiring locator under the session id', async () => {
  const { io, files } = sharedIO();
  await advertise(io, { sid, addresses: [address, address], expiresAt: expiry, code: 'NEVER-WRITE' }, publisher, 0);
  const path = `Supernote Transcripts/Shared Data/Pairing/${publisher}.md`;
  const value = JSON.parse(files.get(path));
  assert.deepEqual(value, { v: 1, sid, addresses: [address], expiresAt: expiry });
  assert.doesNotMatch(files.get(path), /code|NEVER-WRITE/i);
  const nextSid = 'urn:uuid:123e4567-e89b-42d3-a456-426614174003';
  await advertise(io, { sid: nextSid, addresses: [address], expiresAt: expiry }, publisher, 0);
  assert.equal(files.size, 1);
  assert.equal(JSON.parse(files.get(path)).sid, nextSid);
});

test('discover checks only fresh private locators and requires matching live session info', async () => {
  const { io } = sharedIO();
  await advertise(io, { sid, addresses: [address], expiresAt: expiry }, publisher, 0);
  const requests = [];
  const found = await discover(io, async url => {
    requests.push(url);
    return { status: 200, json: { v: 1, sid, expiresIn: 590 } };
  }, 10_000);
  assert.deepEqual(found, [{ address, sid, expiresAt: 600_000 }]);
  assert.deepEqual(requests, [`${address}/info`]);
  const stale = await discover(io, async () => { throw Error('must not probe'); }, expiry);
  assert.deepEqual(stale, []);
});

test('discover rejects wrong sid, expired server, bad status and non-private or credential-bearing records', async () => {
  const { io, files } = sharedIO();
  await advertise(io, { sid, addresses: [address], expiresAt: expiry }, publisher, 0);
  const path = [...files.keys()].find(key => key.endsWith('.md'));
  const responses = [
    { status: 200, json: { v: 1, sid: sid.replace(/0$/, '1'), expiresIn: 500 } },
    { status: 200, json: { v: 1, sid, expiresIn: 0 } },
    { status: 503, json: { v: 1, sid, expiresIn: 500 } },
  ];
  for (const response of responses) {
    assert.deepEqual(await discover(io, async () => response, 1), []);
  }
  for (const invalid of [
    { v: 1, sid, addresses: ['http://8.8.8.8:19457'], expiresAt: expiry },
    { v: 1, sid, addresses: ['http://192.168.1.12:19456'], expiresAt: expiry },
    { v: 1, sid, addresses: ['http://192.168.1.12:19457?token=x'], expiresAt: expiry },
    { v: 1, sid, addresses: [address], expiresAt: expiry, code: 'do-not-accept' },
  ]) {
    files.set(path, JSON.stringify(invalid));
    assert.deepEqual(await discover(io, async () => { throw Error('invalid descriptor was probed'); }, 1), []);
  }
});

test('discover caps probes and treats timed-out or failed requests as unavailable', async () => {
  const { io, files } = sharedIO();
  const addresses = Array.from({ length: 8 }, (_, i) => `http://192.168.1.${i + 1}:19457`);
  await advertise(io, { sid, addresses, expiresAt: expiry }, publisher, 0);
  const seen = [];
  await discover(io, async url => { seen.push(url); throw Error('offline'); }, 0);
  assert.equal(seen.length, 8);
  assert.ok(seen.every(url => /^http:\/\/192\.168\.1\.\d+:19457\/info$/.test(url)));

  files.set([...files.keys()].find(key => key.endsWith('.md')), JSON.stringify({ v: 1, sid, addresses: [address], expiresAt: expiry }));
  const timed = await discover(io, () => new Promise(() => {}), 0);
  assert.deepEqual(timed, []);
});
