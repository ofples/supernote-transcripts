import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { build } from "esbuild";
import { openPairing, sealPairing } from "../src/subscription-pairing-crypto.mjs";

const bundled = await build({ entryPoints: ["src/subscription-pairing-host.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { DesktopPairingHost } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw Error("Mock HTTP request did not settle");
}

function fakeHttp({ failPort, deferPort } = {}) {
  const servers = [];
  const http = { createServer(handler) {
    const server = new EventEmitter();
    server.handler = handler;
    server.listen = (port, host) => {
      server.port = port; server.host = host;
      const finish = () => {
        if (port === failPort) server.emit("error", Error("bind failure"));
        else { server.listening = true; server.emit("listening"); }
      };
      if (port === deferPort) server.finishListen = finish;
      else setImmediate(finish);
      return server;
    };
    server.close = () => { server.closed = true; server.emit("close"); return server; };
    servers.push(server);
    return server;
  } };
  function invoke(server, { method = "GET", url = "/", host, peer, headers = {}, body = "" }) {
    const req = {
      method, url, headers: { host, ...headers }, socket: { remoteAddress: peer },
      setTimeout() {},
      async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); },
    };
    const res = {
      headers: {}, statusCode: 200, headersSent: false, ended: false,
      setHeader(key, value) { this.headers[key] = value; },
      writeHead(code) { this.statusCode = code; this.headersSent = true; },
      end(value = "") { this.body = value; this.ended = true; },
    };
    server.handler(req, res);
    return waitFor(() => res.ended).then(() => res);
  }
  return { http, servers, invoke };
}

const hostAddress = "http://192.168.1.42:19457";
const authUrl = (state = "A".repeat(43), extra = "") => {
  const url = new URL("https://auth.openai.com/api/accounts/authorize");
  for (const [key, value] of Object.entries({
    client_id: "oaiapp_test", ext_agent_host_id: "urn:uuid:00000000-0000-4000-8000-000000000001",
    response_type: "code", redirect_uri: "http://127.0.0.1:19456/auth/callback",
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1", state, nonce: "B".repeat(43),
    code_challenge_method: "S256", code_challenge: "C".repeat(43),
  })) url.searchParams.set(key, value);
  if (extra) url.search += "&" + extra;
  return url.href;
};

function setup(opts = {}) {
  const mock = fakeHttp(opts);
  const opened = [], changes = [];
  const pairing = new DesktopPairingHost({
    http: () => mock.http,
    addresses: () => ["192.168.1.42", "10.0.0.4", "172.20.2.5", "8.8.8.8", "127.0.0.1"],
    openUrl: (url) => opened.push(url), changed: () => changes.push(true),
  });
  return { pairing, mock, opened, changes };
}

const lanCall = (mock, path, { method = "GET", peer = "192.168.1.80", headers = {}, value } = {}) =>
  mock.invoke(mock.servers.filter((server) => server.port === 19457 && !server.closed).at(-1), { method, url: path, host: "192.168.1.42:19457", peer, headers,
    body: value === undefined ? "" : JSON.stringify(value) });

test("binds private LAN and loopback listeners, serves info, and rejects origins or unadvertised hosts", async (t) => {
  const { pairing, mock } = setup();
  t.after(() => pairing.close());
  await pairing.start();
  assert.deepEqual(mock.servers.map(({ port, host }) => [port, host]), [[19457, "0.0.0.0"], [19456, "127.0.0.1"]]);
  assert.deepEqual(pairing.state.addresses, [hostAddress, "http://10.0.0.4:19457", "http://172.20.2.5:19457"]);
  assert.match(pairing.state.code, /^(?:[2-9A-HJ-NP-Z]{4}-){4}[2-9A-HJ-NP-Z]{4}$/);
  assert.match(pairing.state.sid, /^urn:uuid:[0-9a-f-]{36}$/i);
  const info = await lanCall(mock, "/info");
  assert.equal(info.statusCode, 200);
  assert.deepEqual(JSON.parse(info.body), { v: 1, sid: JSON.parse(info.body).sid, expiresIn: 600 });
  assert.match(JSON.parse(info.body).sid, /^urn:uuid:[0-9a-f-]{36}$/i);
  assert.equal((await mock.invoke(mock.servers[0], { url: "/info", host: "192.168.1.99:19457", peer: "192.168.1.80" })).statusCode, 403);
  assert.equal((await lanCall(mock, "/info", { headers: { origin: "http://evil.test" } })).statusCode, 403);
});

test("claims one peer, opens browser once, returns encrypted callback only to that peer, and closes after ack", async () => {
  const { pairing, mock, opened } = setup();
  await pairing.start();
  const { code } = pairing.state;
  const info = JSON.parse((await lanCall(mock, "/info")).body);
  const request = await sealPairing(code, info.sid, "request", { url: authUrl() });
  const requestReply = await lanCall(mock, "/request", { method: "POST", value: request });
  assert.equal(requestReply.statusCode, 200);
  assert.deepEqual(await openPairing(code, info.sid, "request-reply", JSON.parse(requestReply.body)), { status: "accepted" });
  assert.deepEqual(opened, [authUrl()]);
  const duplicate = await lanCall(mock, "/request", { method: "POST", value: request });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(opened.length, 1);
  const changed = await lanCall(mock, "/request", { method: "POST", value: await sealPairing(code, info.sid, "request", { url: authUrl("D".repeat(43)) }) });
  assert.equal(changed.statusCode, 409);
  assert.equal((await lanCall(mock, "/info", { peer: "192.168.1.81" })).statusCode, 200);

  const callback = await mock.invoke(mock.servers[1], { method: "GET", url: `/auth/callback?code=secret-code&state=${"A".repeat(43)}&client_id=oaiapp_test`, host: "127.0.0.1:19456", peer: "127.0.0.1" });
  assert.equal(callback.statusCode, 200);
  assert.doesNotMatch(callback.body, /secret-code|A{43}|oaiapp_test/);
  const poll = await lanCall(mock, "/result", { method: "POST", value: await sealPairing(code, info.sid, "poll", { op: "poll" }) });
  assert.equal(poll.statusCode, 200);
  assert.deepEqual(await openPairing(code, info.sid, "poll-reply", JSON.parse(poll.body)), {
    status: "ready", result: { code: "secret-code", state: "A".repeat(43), client_id: "oaiapp_test" },
  });
  const ack = await lanCall(mock, "/ack", { method: "POST", value: await sealPairing(code, info.sid, "ack", { op: "ack" }) });
  assert.deepEqual(await openPairing(code, info.sid, "ack-reply", JSON.parse(ack.body)), { status: "closed" });
  assert.equal(pairing.state.code, "");
  assert.equal(mock.servers.every((server) => server.closed), true);
});

test("callback rejects wrong peer, origin, duplicate parameters, stale state, and non-denial OAuth errors", async (t) => {
  const { pairing, mock } = setup();
  t.after(() => pairing.close());
  await pairing.start();
  const { code } = pairing.state, sid = JSON.parse((await lanCall(mock, "/info")).body).sid;
  await lanCall(mock, "/request", { method: "POST", value: await sealPairing(code, sid, "request", { url: authUrl() }) });
  const callback = (url, peer = "127.0.0.1", headers = {}) => mock.invoke(mock.servers[1], { method: "GET", url, host: "127.0.0.1:19456", peer, headers });
  assert.equal((await callback(`/auth/callback?code=c&state=${"A".repeat(43)}&client_id=oaiapp_test`, "192.168.1.42")).statusCode, 403);
  assert.equal((await callback(`/auth/callback?code=c&state=${"A".repeat(43)}&client_id=oaiapp_test`, "127.0.0.1", { origin: "null" })).statusCode, 403);
  assert.equal((await callback(`/auth/callback?code=c&state=${"A".repeat(43)}&state=${"A".repeat(43)}&client_id=oaiapp_test`)).statusCode, 400);
  assert.equal((await callback(`/auth/callback?code=c&state=${"Z".repeat(43)}&client_id=oaiapp_test`)).statusCode, 400);
  assert.equal((await callback(`/auth/callback?error=server_error&state=${"A".repeat(43)}&client_id=oaiapp_test`)).statusCode, 400);
  assert.equal((await callback(`/auth/callback?error=access_denied&state=${"A".repeat(43)}&client_id=oaiapp_test`)).statusCode, 200);
});

test("callback accepts only issued dynamic client IDs, allows an omitted fixed ID, and preserves safe scope", async (t) => {
  const { pairing, mock } = setup();
  t.after(() => pairing.close());
  await pairing.start();
  const code = pairing.state.code, sid = JSON.parse((await lanCall(mock, "/info")).body).sid;
  const dynamicUrl = new URL(authUrl());
  dynamicUrl.searchParams.set("client_id", "dynamic_agent_client");
  dynamicUrl.searchParams.set("agent_name_hint", "Supernote Transcripts");
  const dynamic = dynamicUrl.href;
  await lanCall(mock, "/request", { method: "POST", value: await sealPairing(code, sid, "request", { url: dynamic }) });
  const callback = (url) => mock.invoke(mock.servers[1], { method: "GET", url, host: "127.0.0.1:19456", peer: "127.0.0.1" });
  assert.equal((await callback(`/auth/callback?code=c&state=${"A".repeat(43)}`)).statusCode, 400);
  assert.equal((await callback(`/auth/callback?code=c&state=${"A".repeat(43)}&client_id=unissued`)).statusCode, 400);
  assert.equal((await callback(`/auth/callback?code=c&state=${"A".repeat(43)}&client_id=oaiapp_issued&scope=openid%20profile&iss=https%3A%2F%2Fauth.openai.com`)).statusCode, 200);
  const poll = await lanCall(mock, "/result", { method: "POST", value: await sealPairing(code, sid, "poll", { op: "poll" }) });
  assert.deepEqual((await openPairing(code, sid, "poll-reply", JSON.parse(poll.body))).result,
    { code: "c", state: "A".repeat(43), client_id: "oaiapp_issued", scope: "openid profile" });

  const fixed = setup();
  t.after(() => fixed.pairing.close());
  await fixed.pairing.start();
  const fixedCode = fixed.pairing.state.code, fixedSid = JSON.parse((await lanCall(fixed.mock, "/info")).body).sid;
  await lanCall(fixed.mock, "/request", { method: "POST", value: await sealPairing(fixedCode, fixedSid, "request", { url: authUrl() }) });
  assert.equal((await fixed.mock.invoke(fixed.mock.servers[1], { method: "GET", url: `/auth/callback?code=c&state=${"A".repeat(43)}`, host: "127.0.0.1:19456", peer: "127.0.0.1" })).statusCode, 200);
});

test("invalid authorization URL never claims peer or opens browser", async (t) => {
  const { pairing, mock, opened } = setup();
  t.after(() => pairing.close());
  await pairing.start();
  const info = JSON.parse((await lanCall(mock, "/info")).body);
  const response = await lanCall(mock, "/request", { method: "POST", value: await sealPairing(pairing.state.code, info.sid, "request", { url: authUrl() + "&state=duplicate" }) });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(opened, []);
});

test("bind failure cleans up both servers and no-address start fails closed", async () => {
  const failed = setup({ failPort: 19456 });
  await assert.rejects(failed.pairing.start(), /could not bind/);
  assert.equal(failed.mock.servers.every((server) => server.closed), true);
  assert.equal(failed.pairing.state.code, "");
  const none = new DesktopPairingHost({ http: () => failed.mock.http, addresses: () => ["8.8.8.8", "127.0.0.1"], openUrl() {}, changed() {} });
  await assert.rejects(none.start(), /No private IPv4/);
});

test("close during an asynchronous bind rejects start and closes captured listeners", async () => {
  const mock = fakeHttp({ deferPort: 19456 });
  let host;
  host = new DesktopPairingHost({ http: () => mock.http, addresses: () => ["192.168.1.42"], openUrl() {}, changed() {} });
  const starting = host.start();
  await waitFor(() => mock.servers.length === 2 && mock.servers[0].listening);
  host.close("Cancelled");
  mock.servers[1].finishListen();
  await assert.rejects(starting, /could not bind/);
  assert.equal(mock.servers.every((server) => server.closed), true);
  assert.equal(host.state.code, "");
});

test("five invalid encrypted requests close the relay and expiry is enforced on every route", async () => {
  const failed = setup();
  await failed.pairing.start();
  const info = JSON.parse((await lanCall(failed.mock, "/info")).body);
  for (let i = 0; i < 5; i++) await lanCall(failed.mock, "/request", { method: "POST", value: { v: 1, sid: info.sid, iv: "bad", data: "bad" } });
  assert.equal(failed.pairing.state.code, "");
  assert.equal(failed.mock.servers.every((server) => server.closed), true);

  const expired = setup();
  let now = Date.now();
  const host = new DesktopPairingHost({ http: () => expired.mock.http, addresses: () => ["192.168.1.42"], openUrl() {}, changed() {}, now: () => now });
  await host.start(); now += 600001;
  assert.equal((await expired.mock.invoke(expired.mock.servers[0], { url: "/info", host: "192.168.1.42:19457", peer: "192.168.1.80" })).statusCode, 410);
  assert.equal(host.state.code, "");
  assert.equal(expired.mock.servers.every((server) => server.closed), true);
});

test("restarting one host resets the browser-open and decrypt-failure state", async (t) => {
  const { pairing, mock, opened } = setup();
  t.after(() => pairing.close());
  await pairing.start();
  let info = JSON.parse((await lanCall(mock, "/info")).body);
  for (let i = 0; i < 4; i++) await lanCall(mock, "/request", { method: "POST", value: { v: 1, sid: info.sid, iv: "bad", data: "bad" } });
  const firstCode = pairing.state.code;
  await lanCall(mock, "/request", { method: "POST", value: await sealPairing(firstCode, info.sid, "request", { url: authUrl() }) });
  assert.equal(opened.length, 1);
  pairing.close("Restarting");
  await pairing.start();
  info = JSON.parse((await lanCall(mock, "/info")).body);
  const secondCode = pairing.state.code;
  const bad = await lanCall(mock, "/request", { method: "POST", value: { v: 1, sid: info.sid, iv: "bad", data: "bad" } });
  assert.equal(bad.statusCode, 400);
  assert.notEqual(secondCode, firstCode);
  const second = await lanCall(mock, "/request", { method: "POST", value: await sealPairing(secondCode, info.sid, "request", { url: authUrl("D".repeat(43)) }) });
  assert.equal(second.statusCode, 200);
  assert.equal(opened.length, 2);
});
