import { createPairingCode, openPairing, sealPairing, validatePairingAuthorization } from "./subscription-pairing-crypto.mjs";

const LAN_PORT = 19457;
const CALLBACK_PORT = 19456;
const LIFETIME_MS = 10 * 60 * 1000;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_CALLBACK_BYTES = 16 * 1024;
const securityHeaders: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

type HostState = { code: string; sid: string; addresses: string[]; status: string; expiresAt: number };
type Authorization = { url: string; state: string; clientId: string };
type OAuthResult = Record<string, string>;
type HttpServer = import("node:http").Server;
type Options = {
  http?: () => typeof import("node:http");
  addresses?: () => string[];
  openUrl: (url: string) => void;
  changed: () => void;
  now?: () => number;
};

function privateV4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function localAddresses(): string[] {
  const interfaces = (require("os") as typeof import("node:os")).networkInterfaces();
  return Object.values(interfaces).flatMap((rows) => (rows ?? [])
    .filter((row) => row.family === "IPv4" && !row.internal && privateV4(row.address))
    .map((row) => row.address));
}

function normalizedPeer(value: string | undefined): string {
  return (value ?? "").replace(/^::ffff:/i, "");
}

function setHeaders(res: import("node:http").ServerResponse) {
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
}

function reply(res: import("node:http").ServerResponse, status: number, value: unknown, json = true) {
  if (res.headersSent) return;
  setHeaders(res);
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(json ? JSON.stringify(value) : String(value));
}

async function readJson(req: import("node:http").IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw Error("large");
  req.setTimeout(5000, () => req.destroy());
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw Error("large");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Error("invalid"); }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oauthResult(url: URL, authorization: Authorization): OAuthResult {
  const entries = [...url.searchParams.entries()];
  if (entries.some(([key]) => !["code", "state", "client_id", "error", "error_description", "scope", "iss"].includes(key))
    || [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get("state") !== authorization.state) throw Error("invalid callback");
  if (url.searchParams.has("iss") && url.searchParams.get("iss") !== "https://auth.openai.com") throw Error("invalid callback");
  const clientId = url.searchParams.get("client_id");
  const dynamicClient = authorization.clientId === "dynamic_agent_client";
  const denied = url.searchParams.get("error") === "access_denied" && !url.searchParams.has("code");
  const clientMatches = url.searchParams.has("client_id")
    ? !!clientId && (dynamicClient ? /^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) : clientId === authorization.clientId)
    : (!dynamicClient || denied);
  const description = url.searchParams.get("error_description");
  if (!clientMatches || (description !== null && (description.length > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)))) throw Error("invalid callback");
  if (denied) {
    return { error: "access_denied", state: authorization.state, ...(clientId ? { client_id: clientId } : {}) };
  }
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope");
  if (!code || code.length > 8192 || /[\u0000-\u0020\u007f]/.test(code)
    || url.searchParams.has("error") || (scope !== null && (scope.length > 2048 || /[\u0000-\u001f\u007f]/.test(scope)))) throw Error("invalid callback");
  return { code, state: authorization.state, client_id: clientId ?? authorization.clientId, ...(scope ? { scope } : {}) };
}

export class DesktopPairingHost {
  private readonly now: () => number;
  private readonly httpFactory: () => typeof import("node:http");
  private readonly addressFactory: () => string[];
  private code?: string;
  private sid?: string;
  private expiresAt = 0;
  private status = "Not started";
  private addresses: string[] = [];
  private lanServer?: HttpServer;
  private callbackServer?: HttpServer;
  private timer?: ReturnType<typeof setTimeout>;
  private starting?: Promise<void>;
  private peer?: string;
  private authorization?: Authorization;
  private result?: OAuthResult;
  private opened = false;
  private decryptFailures = 0;
  private generation = 0;
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.httpFactory = options.http ?? (() => require("http"));
    this.addressFactory = options.addresses ?? localAddresses;
  }

  get state(): HostState {
    return { code: this.code ?? "", sid: this.sid ?? "", addresses: [...this.addresses], status: this.status, expiresAt: this.expiresAt };
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.lanServer || this.callbackServer) return Promise.resolve();
    this.starting = this.startInternal().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startInternal() {
    const ips = [...new Set(this.addressFactory().filter(privateV4))];
    if (!ips.length) throw Error("No private IPv4 address is available for pairing.");
    const code = createPairingCode();
    const sid = `urn:uuid:${globalThis.crypto.randomUUID()}`;
    const generation = ++this.generation;
    const addresses = ips.map((ip) => `http://${ip}:${LAN_PORT}`);
    const http = this.httpFactory();
    const lan = http.createServer((req, res) => { void this.handleLan(req, res, generation).catch(() => reply(res, 400, { error: "Invalid request" })); });
    const callback = http.createServer((req, res) => { void this.handleCallback(req, res, generation).catch(() => reply(res, 400, "Invalid sign-in return", false)); });
    const onServerError = () => { if (generation === this.generation) this.close("Pairing listener failed"); };
    lan.on("error", onServerError);
    callback.on("error", onServerError);
    this.opened = false;
    this.decryptFailures = 0;
    this.lanServer = lan;
    this.callbackServer = callback;
    try {
      await this.listen(lan, LAN_PORT, "0.0.0.0");
      if (generation !== this.generation) throw Error("superseded");
      await this.listen(callback, CALLBACK_PORT, "127.0.0.1");
      if (generation !== this.generation) throw Error("superseded");
    } catch {
      try { lan.close(); } catch { /* listener may not have bound */ }
      try { callback.close(); } catch { /* listener may not have bound */ }
      if (generation === this.generation) this.close("Pairing host could not bind its local listeners.");
      throw Error("Pairing host could not bind its local listeners.");
    }
    this.code = code;
    this.sid = sid;
    this.addresses = addresses;
    this.expiresAt = this.now() + LIFETIME_MS;
    this.status = "Waiting for Nomad";
    this.timer = setTimeout(() => this.close("Pairing expired"), LIFETIME_MS);
    this.timer.unref?.();
    this.options.changed();
  }

  private listen(server: HttpServer, port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => { server.removeListener("listening", onListening); server.removeListener("close", onClose); reject(error); };
      const onListening = () => { server.removeListener("error", onError); server.removeListener("close", onClose); resolve(); };
      const onClose = () => { server.removeListener("error", onError); server.removeListener("listening", onListening); reject(Error("listener closed")); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.once("close", onClose);
      server.listen(port, host);
    });
  }

  private active(generation: number): boolean {
    if (generation !== this.generation) return false;
    if (!this.code || !this.sid || this.now() >= this.expiresAt) {
      if (this.code) this.close("Pairing expired");
      return false;
    }
    return true;
  }

  private async handleLan(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, generation: number) {
    if (!this.active(generation)) { reply(res, 410, { error: "Pairing unavailable" }); return; }
    const peer = normalizedPeer(req.socket.remoteAddress);
    const host = req.headers.host;
    if ((!privateV4(peer) && peer !== "127.0.0.1") || req.headers.origin !== undefined || typeof host !== "string"
      || !this.addresses.some((address) => address.slice("http://".length) === host)) {
      reply(res, 403, { error: "Forbidden" }); return;
    }
    let url: URL;
    try { url = new URL(req.url ?? "/", `http://${host}`); }
    catch { reply(res, 400, { error: "Invalid request" }); return; }
    if (url.origin !== `http://${host}` || url.search || url.hash) { reply(res, 400, { error: "Invalid request" }); return; }
    if (req.method === "GET" && url.pathname === "/info") {
      reply(res, 200, { v: 1, sid: this.sid, expiresIn: Math.max(0, Math.ceil((this.expiresAt - this.now()) / 1000)) }); return;
    }
    if (req.method !== "POST" || !["/request", "/result", "/ack"].includes(url.pathname)) {
      reply(res, 404, { error: "Not found" }); return;
    }
    const code = this.code!, sid = this.sid!;
    let envelope: unknown;
    try { envelope = await readJson(req, MAX_REQUEST_BYTES); }
    catch (error) { reply(res, error instanceof Error && error.message === "large" ? 413 : 400, { error: "Invalid request" }); return; }
    if (!this.active(generation) || this.code !== code || this.sid !== sid) { reply(res, 410, { error: "Pairing unavailable" }); return; }
    const purpose = url.pathname === "/request" ? "request" : url.pathname === "/result" ? "poll" : "ack";
    let message: Record<string, unknown>;
    try { message = await openPairing(code, sid, purpose, envelope); }
    catch {
      const current = this.active(generation) && this.code === code && this.sid === sid;
      if (current) this.decryptFailures++;
      reply(res, current ? 400 : 410, { error: current ? "Invalid request" : "Pairing unavailable" });
      if (current && this.decryptFailures >= 5) this.close("Pairing closed after invalid requests");
      return;
    }
    if (!this.active(generation) || this.code !== code || this.sid !== sid) { reply(res, 410, { error: "Pairing unavailable" }); return; }
    if (url.pathname === "/request") { await this.handleRequest(peer, message, res, generation, code, sid); return; }
    if (this.peer !== peer) { reply(res, 403, { error: "Forbidden" }); return; }
    if (url.pathname === "/result") { await this.handlePoll(message, res, generation, code, sid); return; }
    await this.handleAck(message, res, generation, code, sid);
  }

  private async handleRequest(peer: string, message: Record<string, unknown>, res: import("node:http").ServerResponse,
    generation: number, code: string, sid: string) {
    if (Object.keys(message).length !== 1 || typeof message.url !== "string") { reply(res, 400, { error: "Invalid request" }); return; }
    let checked: Authorization;
    try { checked = validatePairingAuthorization(message.url); }
    catch { reply(res, 400, { error: "Invalid request" }); return; }
    if (this.peer && (this.peer !== peer || this.authorization?.url !== checked.url)) {
      reply(res, this.peer === peer ? 409 : 403, { error: "Pairing already claimed" }); return;
    }
    if (!this.peer) {
      this.peer = peer;
      this.authorization = checked;
      this.status = "Waiting for browser sign-in";
      this.options.changed();
      if (!this.active(generation) || this.code !== code || this.sid !== sid) { reply(res, 410, { error: "Pairing unavailable" }); return; }
      if (!this.opened) {
        this.opened = true;
        try { this.options.openUrl(checked.url); }
        catch { this.close("Unable to open browser"); reply(res, 503, { error: "Pairing unavailable" }); return; }
      }
    }
    const response = await sealPairing(code, sid, "request-reply", { status: "accepted" });
    if (!this.active(generation) || this.code !== code || this.sid !== sid) { reply(res, 410, { error: "Pairing unavailable" }); return; }
    reply(res, 200, response);
  }

  private async handlePoll(message: Record<string, unknown>, res: import("node:http").ServerResponse,
    generation: number, code: string, sid: string) {
    if (Object.keys(message).length !== 1 || message.op !== "poll") { reply(res, 400, { error: "Invalid request" }); return; }
    const value = this.result && this.authorization
      ? { status: "ready", result: this.result }
      : { status: "waiting" };
    const response = await sealPairing(code, sid, "poll-reply", value);
    if (!this.active(generation) || this.code !== code || this.sid !== sid) { reply(res, 410, { error: "Pairing unavailable" }); return; }
    reply(res, 200, response);
  }

  private async handleAck(message: Record<string, unknown>, res: import("node:http").ServerResponse,
    generation: number, code: string, sid: string) {
    if (Object.keys(message).length !== 1 || message.op !== "ack") { reply(res, 400, { error: "Invalid request" }); return; }
    const response = await sealPairing(code, sid, "ack-reply", { status: "closed" });
    if (!this.active(generation) || this.code !== code || this.sid !== sid) { reply(res, 410, { error: "Pairing unavailable" }); return; }
    reply(res, 200, response);
    this.close("Pairing complete");
  }

  private async handleCallback(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, generation: number) {
    if (!this.active(generation)) { reply(res, 410, "Sign-in unavailable", false); return; }
    if (req.headers.origin !== undefined || req.headers.host !== "127.0.0.1:19456"
      || req.method !== "GET" || normalizedPeer(req.socket.remoteAddress) !== "127.0.0.1") {
      reply(res, 403, "Forbidden", false); return;
    }
    const raw = req.url ?? "/";
    if (raw.length > MAX_CALLBACK_BYTES) { reply(res, 413, "Invalid sign-in return", false); return; }
    let url: URL;
    try { url = new URL(raw, "http://127.0.0.1:19456"); }
    catch { reply(res, 400, "Invalid sign-in return", false); return; }
    if (url.origin !== "http://127.0.0.1:19456" || url.pathname !== "/auth/callback" || !this.authorization || this.result) {
      reply(res, 400, "Invalid sign-in return", false); return;
    }
    try { this.result = oauthResult(url, this.authorization); }
    catch { reply(res, 400, "Invalid sign-in return", false); return; }
    this.status = "Browser sign-in returned; waiting for Nomad";
    this.options.changed();
    reply(res, 200, "Return to Nomad to continue.", false);
  }

  close(status = "Closed") {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const lan = this.lanServer, callback = this.callbackServer;
    this.lanServer = undefined;
    this.callbackServer = undefined;
    this.code = undefined;
    this.sid = undefined;
    this.peer = undefined;
    this.authorization = undefined;
    this.result = undefined;
    this.opened = false;
    this.decryptFailures = 0;
    this.addresses = [];
    this.expiresAt = 0;
    this.status = status;
    try { lan?.close(); } catch { /* listener may not have bound */ }
    try { callback?.close(); } catch { /* listener may not have bound */ }
    this.options.changed();
  }
}
