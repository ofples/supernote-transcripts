import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { build } from "esbuild";
import { SECRET, ISSUER, RESOURCE, credentials, identity } from "../src/subscription-auth.mjs";
import { completedText, RecognitionFailure, providerFailure } from "../src/subscription-stream.mjs";
import { EMPTY_PAGE_TEXT } from "../src/prompts.mjs";
import { sealPairing, openPairing } from "../src/subscription-pairing-crypto.mjs";

globalThis.__subscriptionPlatform = { isAndroidApp: false };
const bundle = await build({ entryPoints: ["src/subscription.ts", "src/subscription-usage.ts"], outdir: "unused",
  bundle: true, platform: "node", format: "esm", write: false, plugins: [{ name: "offline-obsidian", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "offline", namespace: "offline" }));
    build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents:
      "export const Platform=globalThis.__subscriptionPlatform;export function requestUrl(){throw Error('Unexpected live request');}" }));
  } }],
});
const load = (name) => import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles.find((f) => f.path.endsWith("/" + name + ".js") || f.path.endsWith("\\" + name + ".js")).text).toString("base64"));
const { ChatGPTSession, SUBSCRIPTION_RETURN_ACTION } = await load("subscription");
const { SubscriptionUsage } = await load("subscription-usage");

test("subscription interruption identity and explicit decision persist without counting another attempt",()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const book=new SubscriptionUsage(storage,'recovery');book.reserve('source','model','recipe',10,'p',1,'fp');
  const restart=new SubscriptionUsage(storage,'recovery');const before=restart.snapshot();
  const rows=restart.recoverableAttempts();assert.equal(rows[0].fingerprint,'fp');assert.equal(rows[0].status,'unconfirmed');
  rows[0].acknowledged=true;assert.equal(restart.recoverableAttempts()[0].acknowledged,false);
  restart.acknowledgeRecovery('source','p','fp');assert.equal(new SubscriptionUsage(storage,'recovery').recoverableAttempts()[0].acknowledged,true);
  assert.deepEqual(restart.snapshot(),before);
  const corrupt=JSON.parse(map.get('recovery'));corrupt[0].fingerprint=123;map.set('recovery',JSON.stringify(corrupt));
  assert.throws(()=>new SubscriptionUsage(storage,'recovery').recoverableAttempts(),/Restore.*usage/);
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setImmediate(r)); } throw Error("Mock operation did not settle"); };
const savedRecord = (extra = {}) => ({ hostId: "urn:uuid:00000000-0000-4000-8000-000000000000", clientId: "oaiapp_test", subject: "subject", email: "test@example.test",
  tokens: { accessToken: "old-access", refreshToken: "old-refresh", scope: "openid chatgpt.tokens.use.direct", expiresAt: Date.now() + 3600000, earliestRefreshAt: 0 }, ...extra });
function storage(record = undefined) {
  let raw = record === undefined ? undefined : typeof record === "string" ? record : JSON.stringify(record);
  const writes = []; let reads = 0;
  const secretStorage = { isEncryptionAvailable: async () => true, getSecret: (key) => { assert.equal(key, SECRET); reads++; return raw; },
    setSecret: async (key, value) => { assert.equal(key, SECRET); raw = value; writes.push(value); } };
  return { app: { secretStorage }, secretStorage, writes, value: () => raw && JSON.parse(raw), reads: () => reads };
}
function httpMock({ fail = false } = {}) {
  const servers = [];
  const http = { createServer(handler) {
    const server = new EventEmitter(); server.handler = handler; server.listening = false; server.closed = false;
    server.listen = (port, host, done) => { assert.equal(port, 19456); assert.equal(host, "127.0.0.1");
      queueMicrotask(() => { if (fail) server.emit("error", Error("Port in use")); else { server.listening = true; done(); } }); return server; };
    server.close = () => { server.closed = true; server.listening = false; return server; }; servers.push(server); return server;
  } };
  const callbackFor = (server, url, changes = {}) => {
    const response = { status: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code) { this.status = code; }, end(text) { this.body = text; } };
    server.handler({ headers: { host: "127.0.0.1:19456" }, method: "GET", socket: { remoteAddress: "127.0.0.1" }, url, ...changes }, response); return response;
  };
  return { http, servers, callback: (url, changes = {}) => callbackFor(servers.at(-1), url, changes), callbackFor };
}
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] };
function jwt(nonce, change = {}) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: ISSUER, aud: "oaiapp_test", sub: "subject", exp: Date.now() / 1000 + 3600, nonce, ...change })).toString("base64url");
  return h + "." + p + "." + sign("RSA-SHA256", Buffer.from(h + "." + p), keys.privateKey).toString("base64url");
}
const grant = (extra = {}) => ({ access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", scope: "openid chatgpt.tokens.use.direct", expires_in: 3600, ...extra });
const event = (data) => "data: " + JSON.stringify(data) + "\n\n";
const complete = event({ type: "response.completed", response: { status: "completed", output: [{ content: [{ type: "output_text", text: "Page" }] }], usage: { input_tokens: 12, output_tokens: 3 } } });

test("parallel initialize/access loads one secure record and encryption requires literal true", async () => {
  const s = storage(savedRecord()), gate = deferred(); s.secretStorage.isEncryptionAvailable = () => gate.promise;
  const session = new ChatGPTSession(s.app, () => {}, { request: async () => { throw Error("Must not send"); } });
  const ready = Promise.all([session.initialize(), session.initialize(), session.access()]); gate.resolve(true); await ready;
  assert.equal(s.reads(), 1); assert.equal(session.connected, true);
  s.secretStorage.isEncryptionAvailable = async () => "true";
  await assert.rejects(session.access(), /Encrypted/);
});

test("malformed secure records fail closed and explicit disconnect resets only the plugin secret", async () => {
  for (const raw of ["{broken", JSON.stringify(savedRecord({ tokens: { accessToken: "x" } })), JSON.stringify(savedRecord({ pending: {} }))]) {
    const s = storage(raw); let sends = 0;
    const session = new ChatGPTSession(s.app, () => {}, { request: async () => { sends++; throw Error("Must not send"); } });
    await session.initialize(); assert.equal(session.connected, false);
    await assert.rejects(session.access()); assert.equal(sends, 0); assert.equal(s.writes.length, 0);
    await session.disconnect(); assert.equal(session.status, "Disconnected"); assert.equal(s.value().tokens, undefined);
  }
});

test("desktop bind failure cleans listener and concurrent sign-in creates one attempt", async () => {
  const s = storage(), mock = httpMock({ fail: true }); let opened = 0;
  const session = new ChatGPTSession(s.app, () => {}, { http: () => mock.http, openUrl: () => opened++ });
  await assert.rejects(Promise.all([session.signIn(), session.signIn()]), /Port in use/);
  assert.equal(mock.servers.length, 1); assert.equal(mock.servers[0].closed, true); assert.equal(opened, 0); assert.equal(s.value().pending, undefined);
});

test("Android explicit retry replaces pending state while preserving registration and valid tokens", async (t) => {
  globalThis.__subscriptionPlatform.isAndroidApp = true;
  t.after(() => { globalThis.__subscriptionPlatform.isAndroidApp = false; });
  const initial = savedRecord({ pending: { state: "A".repeat(43), nonce: "B".repeat(43), verifier: "C".repeat(43), created: Date.now(), clientId: "oaiapp_test", redirect: "http://127.0.0.1:19456/auth/callback" } });
  const s = storage(initial), launches = [], requests = [];
  const session = new ChatGPTSession(s.app, () => {}, { openUrl: (url) => launches.push(new URL(url)), request: async (r) => {
    requests.push(r); return { status: 200, json: { state: initial.pending.state, code: "old-code", client_id: "oaiapp_test" } };
  } });
  const tokens = structuredClone(initial.tokens), hostId = initial.hostId;
  await session.signIn(); const first = s.value().pending;
  await session.signIn(); const second = s.value().pending;
  assert.equal(launches.length, 2); assert.notEqual(second.state, first.state); assert.notEqual(second.nonce, first.nonce); assert.notEqual(second.verifier, first.verifier);
  assert.equal(s.value().hostId, hostId); assert.equal(s.value().clientId, "oaiapp_test");
  assert.deepEqual(s.value().tokens, tokens); assert.equal(launches[1].searchParams.get("authorization") && new URL(launches[1].searchParams.get("authorization")).searchParams.get("client_id"), "oaiapp_test");
  await assert.rejects(session.finish(), /Invalid or expired sign-in return/);
  assert.equal(requests.length, 1); assert.deepEqual(s.value().tokens, tokens);
});

test("desktop explicit retry replaces pending callback state and rejects the older browser return", async (t) => {
  const initial = savedRecord({ pending: { state: "A".repeat(43), nonce: "B".repeat(43), verifier: "C".repeat(43), created: Date.now(), clientId: "oaiapp_test", redirect: "http://127.0.0.1:19456/auth/callback" } });
  const s = storage(initial), mock = httpMock(), tokens = structuredClone(initial.tokens); let opened = 0, requests = 0;
  const session = new ChatGPTSession(s.app, () => {}, { http: () => mock.http, openUrl: () => opened++, request: async () => { requests++; throw Error("No exchange before a valid current callback"); } });
  t.after(() => session.closeCallback());
  await session.signIn(); const first = s.value().pending, oldServer = mock.servers[0];
  await session.signIn(); const second = s.value().pending;
  assert.equal(opened, 2); assert.equal(mock.servers.length, 2); assert.equal(oldServer.closed, true);
  assert.notEqual(second.state, first.state); assert.notEqual(second.nonce, first.nonce); assert.notEqual(second.verifier, first.verifier);
  assert.equal(s.value().hostId, initial.hostId); assert.equal(s.value().clientId, "oaiapp_test"); assert.deepEqual(s.value().tokens, tokens);
  assert.equal(mock.callbackFor(oldServer, `/auth/callback?state=${first.state}&code=old&client_id=oaiapp_test`).status, 400);
  assert.equal(requests, 0); assert.deepEqual(s.value().tokens, tokens);
});

test("Nomad production return routing is distinct and manual Finish works with a legacy helper", async (t) => {
  globalThis.__subscriptionPlatform.isAndroidApp = true;
  t.after(() => { globalThis.__subscriptionPlatform.isAndroidApp = false; });
  const s = storage(); let launched, requests = 0;
  const session = new ChatGPTSession(s.app, () => {}, { openUrl: (url) => { launched = new URL(url); }, request: async (r) => {
    requests++;
    if (r.url === "http://127.0.0.1:19456/result") {
      assert.equal(r.headers["X-Callback-State"], s.value().pending.state);
      return { status: 200, json: { state: s.value().pending.state, code: "code", client_id: "oaiapp_test" } };
    }
    if (r.url.endsWith("/oauth/token")) return { status: 200, json: grant({ id_token: jwt(s.value().pending.nonce) }) };
    if (r.url.includes("openid-configuration")) return { status: 200, json: { issuer: ISSUER, jwks_uri: ISSUER + "/keys", revocation_endpoint: ISSUER + "/revoke" } };
    return { status: 200, json: jwks };
  } });
  await session.signIn();
  assert.equal(launched.protocol, "supernote-login-helper:");
  assert.equal(launched.searchParams.get("return"), "obsidian://" + SUBSCRIPTION_RETURN_ACTION);
  assert.notEqual(SUBSCRIPTION_RETURN_ACTION, "nomad-subscription-return");
  const authorization = new URL(launched.searchParams.get("authorization"));
  assert.equal(authorization.searchParams.get("redirect_uri"), "http://127.0.0.1:19456/auth/callback");
  assert.match(session.status, /return to Supernote Transcripts and choose Finish sign-in/);
  assert.equal(requests, 0);
  // Existing helpers ignore the return routing parameter. The production
  // Finish button calls this same API and reads its own protected callback.
  await session.finish(); assert.equal(session.connected, true);
  assert.equal(s.value().tokens.refreshToken, "new-refresh");
});

test("desktop callback rejects foreign host, method, peer, state and duplicate parameters before exchange; identity completion is one-use", async (t) => {
  const s = storage(), mock = httpMock(), calls = [], exchange = deferred();
  const session = new ChatGPTSession(s.app, () => {}, { http: () => mock.http, openUrl: () => {}, request: async (r) => {
    calls.push(r);
    if (r.url.endsWith("/oauth/token")) { await exchange.promise; return { status: 200, json: grant({ id_token: jwt(s.value().pending.nonce) }) }; }
    if (r.url.includes("openid-configuration")) return { status: 200, json: { issuer: ISSUER, jwks_uri: ISSUER + "/keys", revocation_endpoint: ISSUER + "/revoke" } };
    return { status: 200, json: jwks };
  } });
  t.after(() => session.closeCallback());
  await Promise.all([session.signIn(), session.signIn()]); assert.equal(mock.servers.length, 1);
  const state = s.value().pending.state, valid = `/auth/callback?state=${state}&code=code&client_id=oaiapp_test`;
  assert.equal(mock.callback(valid, { headers: { host: "localhost:19456" } }).status, 403);
  assert.equal(mock.callback(valid, { method: "POST" }).status, 403);
  assert.equal(mock.callback(valid, { socket: { remoteAddress: "192.0.2.1" } }).status, 403);
  assert.equal(mock.callback(valid.replace(state, "wrong")).status, 400);
  assert.equal(mock.callback(valid + "&state=" + state).status, 400); assert.equal(calls.length, 0);
  assert.equal(mock.callback(valid).status, 200);
  assert.equal(mock.callback(valid).status, 409);
  await until(() => calls.length === 1); assert.equal(s.value().pending.used, true);
  await assert.rejects(session.disconnect(), /current account/);
  exchange.resolve(); await until(() => session.connected);
  assert.equal(calls.filter((r) => r.url.endsWith("/oauth/token")).length, 1);
  assert.equal(s.value().tokens.refreshToken, "new-refresh"); assert.equal(s.value().pending, undefined);
  await until(() => mock.servers[0].closed);
});

test("invalid identity leaves no accepted tokens and closes callback after failure", async (t) => {
  const s = storage(), mock = httpMock();
  const session = new ChatGPTSession(s.app, () => {}, { http: () => mock.http, openUrl: () => {}, request: async (r) => {
    if (r.url.endsWith("/oauth/token")) return { status: 200, json: grant({ id_token: jwt("wrong-nonce") }) };
    if (r.url.includes("openid-configuration")) return { status: 200, json: { issuer: ISSUER, jwks_uri: ISSUER + "/keys", revocation_endpoint: ISSUER + "/revoke" } };
    return { status: 200, json: jwks };
  } }); t.after(() => session.closeCallback());
  await session.signIn(); mock.callback(`/auth/callback?state=${s.value().pending.state}&code=x&client_id=oaiapp_test`);
  await until(() => mock.servers[0].closed);
  assert.equal(session.connected, false); assert.equal(s.value().tokens, undefined); assert.equal(s.value().clientId, undefined);
  assert.match(session.status, /could not be verified/);
});

test("parallel access rotates once and persists the new refresh token before all callers proceed", async () => {
  const record = savedRecord(); record.tokens.expiresAt = Date.now() + 1000;
  const s = storage(record), gate = deferred(); let sends = 0;
  const session = new ChatGPTSession(s.app, () => {}, { request: async (r) => {
    sends++; assert.equal(s.value().renewalBlocked, true); assert.equal(new URLSearchParams(r.body).get("refresh_token"), "old-refresh");
    await gate.promise; return { status: 200, json: grant() };
  } });
  const waiting = Promise.all(Array.from({ length: 5 }, () => session.access()));
  await until(() => sends === 1); gate.resolve();
  assert.deepEqual(await waiting, Array(5).fill("new-access")); assert.equal(sends, 1);
  assert.equal(s.value().tokens.refreshToken, "new-refresh"); assert.equal(s.value().renewalBlocked, undefined);
});

test("ambiguous refresh failures are not retried in this session or after restart", async () => {
  const record = savedRecord(); record.tokens.expiresAt = Date.now() + 1000;
  const s = storage(record); let sends = 0;
  const request = async () => { sends++; throw Error("connection ended after token rotation"); };
  const session = new ChatGPTSession(s.app, () => {}, { request });
  assert.equal(session.needsSignIn, false);
  await assert.rejects(session.access(), /No automatic request retry/);
  await assert.rejects(session.access(), /uncertain/);
  assert.equal(session.needsSignIn, true);
  const restarted = new ChatGPTSession(s.app, () => {}, { request }); await assert.rejects(restarted.access(), /uncertain/);
  assert.equal(restarted.needsSignIn, true);
  assert.equal(sends, 1); assert.equal(s.value().renewalBlocked, true);
});

test("renewal-uncertain session can explicitly reconnect while retaining old tokens until verified exchange", async (t) => {
  const initial = savedRecord({ renewalBlocked: true }), s = storage(initial), mock = httpMock();
  const oldTokens = structuredClone(initial.tokens);
  const session = new ChatGPTSession(s.app, () => {}, { http: () => mock.http, openUrl: () => {}, request: async (r) => {
    if (r.url.endsWith("/oauth/token")) {
      assert.deepEqual(s.value().tokens, oldTokens); assert.equal(s.value().renewalBlocked, true);
      return { status: 200, json: grant({ id_token: jwt(s.value().pending.nonce) }) };
    }
    if (r.url.includes("openid-configuration")) return { status: 200, json: { issuer: ISSUER, jwks_uri: ISSUER + "/keys", revocation_endpoint: ISSUER + "/revoke" } };
    return { status: 200, json: jwks };
  } });
  t.after(() => session.closeCallback());
  await session.initialize(); assert.equal(session.connected, true); assert.equal(session.needsSignIn, true);
  await session.signIn(); const pending = s.value().pending;
  assert.equal(s.value().hostId, initial.hostId); assert.equal(s.value().clientId, initial.clientId);
  assert.deepEqual(s.value().tokens, oldTokens); assert.equal(s.value().renewalBlocked, true);
  assert.equal(mock.callback(`/auth/callback?state=${pending.state}&code=fresh&client_id=oaiapp_test`).status, 200);
  await until(() => s.value().pending === undefined && s.value().renewalBlocked === undefined);
  assert.equal(session.connected, true); assert.equal(session.needsSignIn, false);
  assert.equal(s.value().tokens.accessToken, "new-access"); assert.equal(s.value().tokens.refreshToken, "new-refresh");
});

test("earliest refresh, invalid renewal metadata and identity claims reject before reuse", async () => {
  const record = savedRecord(); record.tokens.expiresAt = Date.now() + 1000; record.tokens.earliestRefreshAt = Date.now() + 300000;
  let calls = 0; const session = new ChatGPTSession(storage(record).app, () => {}, { request: async () => { calls++; } });
  await assert.rejects(session.access(), /not yet/); assert.equal(calls, 0);
  assert.throws(() => credentials(grant({ earliest_refresh_at: "bad-time" })), /renewal time/);
  await assert.rejects(identity(jwt("n", { nbf: "later" }), jwks, "oaiapp_test", "n"), /claims/);
  await assert.rejects(identity(jwt("n"), { keys: [jwks.keys[0], jwks.keys[0]] }, "oaiapp_test", "n"), /signing key/);
});

test("reservation callback blocks sending and failed/incomplete sends have exactly one attempt with no fallback", async () => {
  const s = storage(savedRecord()); let calls = 0, reserve = 0;
  let reply = { status: 200, text: complete };
  const session = new ChatGPTSession(s.app, () => {}, { request: async (r) => { calls++; assert.equal(r.url, RESOURCE + "/responses"); return reply; } });
  assert.equal(await session.recognize("custom-model", "data:image/png;base64,AA==", "Instructions", () => false), null); assert.equal(calls, 0);
  await assert.rejects(session.recognize("custom-model", "data:image/png;base64,AA==", "Instructions", () => { throw Error("Reservation cannot persist"); }), /cannot persist/); assert.equal(calls, 0);
  await assert.rejects(session.recognize("custom-model", "https://image.test", "Instructions", () => { reserve++; return true; }), /Invalid/); assert.equal(reserve, 0);
  assert.deepEqual(await session.recognize("custom-model", "data:image/png;base64,AA==", "Instructions", () => true), { text: "Page", usage: { input_tokens: 12, output_tokens: 3 } });
  for (const bad of [{ status: 403 }, { status: 429 }, { status: 200, text: event({ type: "response.incomplete" }) }]) {
    reply = bad; const before = calls; await assert.rejects(session.recognize("custom-model", "data:image/png;base64,AA==", "Instructions", () => true)); assert.equal(calls, before + 1);
  }
});

test("asynchronous admission that pauses after renewal leaves zero sends and no reservation", async () => {
  const s = storage(savedRecord()), gate = deferred(); let calls = 0, entered = false, reservation;
  const session = new ChatGPTSession(s.app, () => {}, { request: async () => { calls++; return { status: 200, text: complete }; } });
  const recognition = session.recognize("custom-model", "data:image/png;base64,AA==", "Instructions", async () => {
    entered = true;
    if (!await gate.promise) return false;
    reservation = "reserved"; return true;
  });
  await until(() => entered); assert.equal(calls, 0); assert.equal(reservation, undefined);
  gate.resolve(false); assert.equal(await recognition, null); assert.equal(calls, 0); assert.equal(reservation, undefined);
});

function ledger(initial) {
  let raw = initial; return { getItem: () => raw ?? null, setItem: (_key, value) => { raw = value; }, raw: () => raw };
}
test("usage counts unknown attempts once through restart and admits remaining daily headroom", () => {
  const data = ledger(), usage = new SubscriptionUsage(data, "usage");
  const a = usage.reserve("a.note", "model", "recipe", 2), b = usage.reserve("b.note", "model", "recipe", 2);
  assert.throws(() => usage.reserve("c.note", "model", "recipe", 2), /limit/);
  usage.finish(b, { usage: { input_tokens: 12, output_tokens: 3 } }); usage.finish(a);
  assert.deepEqual((({bySource,...totals})=>totals)(usage.snapshot()), { requests: 2, pages: 1, inputTokens: 12, outputTokens: 3, unconfirmed: 1, todayRequests:2,day:new Date().toISOString().slice(0,10) });
  const restarted = new SubscriptionUsage(data, "usage"); assert.equal(restarted.snapshot().unconfirmed, 1);
  restarted.resolve(); assert.equal(restarted.snapshot().requests, 2); assert.equal(restarted.snapshot().pages, 1);
  assert.throws(() => restarted.reserve("c.note", "model", "recipe", 2), /limit/);
  const c=restarted.reserve("c.note","model","recipe",3,"native:3",3);restarted.finish(c,{usage:{input_tokens:4,output_tokens:2}},false);
  assert.equal(restarted.snapshot().requests,3);assert.equal(restarted.snapshot().pages,1);assert.equal(restarted.snapshot().inputTokens,16);
  assert.throws(() => restarted.finish(b), /already settled/);
});

test("usage fails closed on corrupt or unsavable storage and turns unfinished reservations into unknown work", () => {
  const pending = ledger(), usage = new SubscriptionUsage(pending, "usage"); usage.reserve("a.note", "model", "recipe", 10);
  const restarted = new SubscriptionUsage(pending, "usage"); assert.equal(restarted.snapshot().unconfirmed, 1);
  const duplicate = JSON.parse(pending.raw()); duplicate.push(duplicate[0]);
  for (const raw of ["bad-json", JSON.stringify(duplicate), JSON.stringify([{ ...duplicate[0], input: -1 }])]) {
    const broken = new SubscriptionUsage(ledger(raw), "usage"); assert.throws(() => broken.reserve("a", "m", "r", 10), /unreadable/);
  }
  const unsavable = new SubscriptionUsage({ getItem: () => null, setItem: () => { throw Error("Disk unavailable"); } }, "usage");
  assert.throws(() => unsavable.reserve("a", "m", "r", 10), /could not be saved/);
  assert.throws(() => unsavable.reserve("a", "m", "r", 10), /unreadable/);
});

test("completed subscription streams reject late failures, duplicate terminals and nontext deltas", () => {
  assert.throws(() => completedText(complete + event({ type: "response.failed", code: "quota" })), /quota/);
  assert.throws(() => completedText(complete + complete), /Ambiguous/);
  assert.throws(() => completedText(event({ type: "response.output_text.delta", delta: {} }) + complete), /delta/);
  assert.equal(completedText(event({ type: "response.output_text.delta", delta: "Partial" }) + complete).text, "Page");
});
test("stream terminal failure kinds retain reported usage and never imply a blank page",()=>{
  const usage={input_tokens:17,output_tokens:4};
  const cases=[
    [{type:"response.incomplete",response:{status:"incomplete",incomplete_details:{reason:"max_output_tokens"},usage}},"incomplete"],
    [{type:"response.completed",response:{status:"completed",output:[],usage}},"empty_response"],
    [{type:"response.completed",response:{status:"completed",output:[{content:[{type:"refusal",refusal:"no"}]}],usage}},"refusal"],
    [{type:"response.failed",response:{status:"failed",error:{code:"server_error"},usage}},"provider"]
  ];
  for(const [terminal,kind] of cases){assert.throws(()=>completedText(event(terminal)),error=>{assert.ok(error instanceof RecognitionFailure);assert.equal(error.kind,kind);assert.equal(error.outcomeKnown,true);assert.deepEqual(error.usage,usage);return true;});}
  assert.throws(()=>completedText(event({type:"response.output_text.delta",delta:"partial"})),error=>error.kind==="missing_terminal"&&!error.outcomeKnown);
  assert.equal(completedText(event({type:"response.completed",response:{status:"completed",output:[{content:[{type:"output_text",text:EMPTY_PAGE_TEXT}]}],usage}})).text,EMPTY_PAGE_TEXT);
  assert.equal(providerFailure(400,{error:{code:"invalid_model"}}).scope,"source");assert.equal(providerFailure(429,{}).scope,"batch");
});

test("subscription grouped accounting counts one request, valid pages and per-target recovery",()=>{
 const data=ledger(),usage=new SubscriptionUsage(data,"usage");const targets=[{pageId:"a",page:1,fingerprint:"fa"},{pageId:"b",page:2,fingerprint:"fb"},{pageId:"c",page:3,fingerprint:"fc"}];
 const id=usage.reserve("book.note","model","recipe",1,undefined,undefined,undefined,targets);
 usage.finish(id,{usage:{input_tokens:100,output_tokens:50}},true,2);
 assert.equal(usage.snapshot().requests,1);assert.equal(usage.snapshot().pages,2);assert.equal(usage.snapshot().bySource[0].pages,2);assert.equal(usage.average("model","recipe").samples,2);
 assert.throws(()=>usage.reserve("book.note","model","recipe",1),/Daily/);
 usage.acknowledgeRecovery("book.note","a","fa");const rows=new SubscriptionUsage(data,"usage").recoverableAttempts();assert.equal(rows.length,3);assert.equal(rows[0].acknowledged,true);assert.equal(rows[1].acknowledged,false);
});

test("subscription grouped transport sends distinct labeled images and configured reasoning allowance",async()=>{
 const s=storage(savedRecord());let sent;const session=new ChatGPTSession(s.app,()=>{},{request:async r=>{sent=JSON.parse(r.body);return {status:200,text:complete};}});
 const image="data:image/png;base64,AA==";await session.recognize("gpt-6.1-sol",image,"Instructions",()=>true,{images:[{label:"TARGET PAGE 1",image},{label:"TARGET PAGE 2",image},{label:"CONTEXT PAGE 3",image}],reasoningEffort:"high",maxOutputTokens:16384});
 assert.equal(sent.max_output_tokens,16384);assert.deepEqual(sent.reasoning,{effort:"high"});assert.equal(sent.input[0].content.filter(c=>c.type==="input_image").length,3);assert.deepEqual(sent.input[0].content.filter(c=>c.type==="input_text").map(c=>c.text),["Instructions","TARGET PAGE 1","TARGET PAGE 2","CONTEXT PAGE 3"]);
});

test("Nomad desktop pairing exchanges its own PKCE code and never transfers tokens to desktop", async (t) => {
  globalThis.__subscriptionPlatform.isAndroidApp = true;
  const initial = savedRecord(), s = storage(initial), calls = [];
  const address = "http://192.168.1.2:19457", code = "A1".repeat(16), sid = "urn:uuid:11111111-1111-4111-8111-111111111111";
  let authorization, waiting = true, acknowledged = false;
  const session = new ChatGPTSession(s.app, () => {}, { request: async (r) => {
    calls.push(r.url);
    if (r.url === address + "/info") return { status: 200, json: { v: 1, sid, expiresIn: 599 } };
    if (r.url === address + "/request") {
      const data = await openPairing(code, sid, "request", JSON.parse(r.body));
      authorization = new URL(data.url);
      assert.equal(authorization.searchParams.get("ext_agent_host_id"), initial.hostId);
      assert.equal(authorization.searchParams.get("client_id"), initial.clientId);
      assert.equal(data.tokens, undefined);
      return { status: 200, json: await sealPairing(code, sid, "request-reply", { status: "accepted" }) };
    }
    if (r.url === address + "/result") {
      assert.equal((await openPairing(code, sid, "poll", JSON.parse(r.body))).op, "poll");
      return { status: 200, json: await sealPairing(code, sid, "poll-reply", waiting ? { status: "waiting" } : {
        status: "ready", result: { state: authorization.searchParams.get("state"), code: "nomad-one-use-code", client_id: initial.clientId },
      }) };
    }
    if (r.url === ISSUER + "/api/accounts/oauth/token") {
      const form = new URLSearchParams(r.body);
      assert.equal(form.get("code"), "nomad-one-use-code");
      assert.equal(form.get("code_verifier"), s.value().pending.verifier);
      assert.equal(form.get("client_id"), initial.clientId);
      return { status: 200, json: grant({ id_token: jwt(authorization.searchParams.get("nonce")) }) };
    }
    if (r.url === ISSUER + "/.well-known/openid-configuration") return { status: 200, json: { issuer: ISSUER, jwks_uri: ISSUER + "/keys", revocation_endpoint: ISSUER + "/revoke" } };
    if (r.url === ISSUER + "/keys") return { status: 200, json: jwks };
    if (r.url === address + "/ack") {
      assert.equal((await openPairing(code, sid, "ack", JSON.parse(r.body))).op, "ack");
      acknowledged = true; return { status: 200 };
    }
    throw Error("Unexpected endpoint");
  } });
  t.after(() => { session.closeCallback(); globalThis.__subscriptionPlatform.isAndroidApp = false; });
  await session.pairWithDesktop(address, code);
  assert.deepEqual(s.value().tokens, initial.tokens);
  assert.equal(s.value().pending.pairing.code, code);
  await session.finish(); assert.deepEqual(s.value().tokens, initial.tokens);
  waiting = false; await session.finish();
  assert.equal(session.connected, true); assert.equal(acknowledged, true);
  assert.equal(s.value().tokens.accessToken, "new-access");
  assert.equal(s.value().hostId, initial.hostId); assert.equal(s.value().pending, undefined);
  assert.equal(calls.filter(url => url.endsWith("/oauth/token")).length, 1);
  assert.equal(calls.some(url => url.includes("/responses") || url.includes("/models")), false);
});

test("pairing rejects an unauthenticated desktop reply without changing a saved session", async (t) => {
  globalThis.__subscriptionPlatform.isAndroidApp = true;
  const initial = savedRecord(), s = storage(initial), sid = "urn:uuid:22222222-2222-4222-8222-222222222222";
  let calls = 0;
  const session = new ChatGPTSession(s.app, () => {}, { request: async () => {
    calls++;
    return calls === 1 ? { status: 200, json: { v: 1, sid, expiresIn: 590 } }
      : { status: 200, json: await sealPairing("B2".repeat(16), sid, "request-reply", { status: "accepted" }) };
  } });
  t.after(() => { session.closeCallback(); globalThis.__subscriptionPlatform.isAndroidApp = false; });
  await assert.rejects(session.pairWithDesktop("http://192.168.1.2:19457", "A1".repeat(16)), /authentication/);
  assert.deepEqual(s.value().tokens, initial.tokens); assert.equal(calls, 2);
});

test("pairing validates its address and code before making any request", async (t) => {
  globalThis.__subscriptionPlatform.isAndroidApp = true;
  const s = storage(savedRecord()); let calls = 0;
  const session = new ChatGPTSession(s.app, () => {}, { request: async () => { calls++; throw Error("Must not send"); } });
  t.after(() => { session.closeCallback(); globalThis.__subscriptionPlatform.isAndroidApp = false; });
  await assert.rejects(session.pairWithDesktop("https://example.test", "A1".repeat(16)));
  await assert.rejects(session.pairWithDesktop("http://192.168.1.2:19457", "123456"));
  assert.equal(calls, 0); assert.equal(s.writes.length, 0);
});

test("cancel pairing preserves existing credentials and expiry refuses polling after restart", async (t) => {
  globalThis.__subscriptionPlatform.isAndroidApp = true;
  const created = Date.now() - 700000, initial = savedRecord({ renewalBlocked: true });
  initial.pending = { state: "A".repeat(43), nonce: "B".repeat(43), verifier: "C".repeat(43),
    created, clientId: initial.clientId, redirect: "http://127.0.0.1:19456/auth/callback",
    pairing: { address: "http://192.168.1.2:19457", code: "A1".repeat(16),
      sid: "urn:uuid:33333333-3333-4333-8333-333333333333", expiresAt: created + 600000 } };
  const s = storage(initial); let calls = 0;
  const session = new ChatGPTSession(s.app, () => {}, { request: async () => { calls++; throw Error("Must not send"); } });
  t.after(() => { session.closeCallback(); globalThis.__subscriptionPlatform.isAndroidApp = false; });
  await session.initialize(); assert.equal(session.pairingPending, true);
  await assert.rejects(session.finish(), /expired/); assert.equal(calls, 0);
  await session.cancelPairing(); assert.equal(session.pairingPending, false);
  assert.deepEqual(s.value().tokens, initial.tokens);
  assert.equal(s.value().hostId, initial.hostId); assert.equal(s.value().clientId, initial.clientId);
  assert.equal(s.value().renewalBlocked, true); assert.equal(s.value().pending, undefined);
  assert.equal(session.status, "Session renewal uncertain. Sign in again.");
});
