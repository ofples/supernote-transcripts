import { Platform, requestUrl } from "obsidian";
import { begin, exchangeForm, identity, credentials, refreshForm, storedSession, SECRET, ISSUER, RESOURCE } from "./subscription-auth.mjs";
import { completedText, catalogModels, RecognitionFailure, providerFailure } from "./subscription-stream.mjs";
import { DesktopPairingHost } from "./subscription-pairing-host";
import { normalizePairingCode, pairingAddress, sealPairing, openPairing } from "./subscription-pairing-crypto.mjs";

type Session = { hostId: string; clientId?: string; subject?: string; email?: string; pending?: any; tokens?: any; renewalBlocked?: boolean };
type Dependencies = { request?: typeof requestUrl; http?: () => typeof import("node:http"); openUrl?: (url: string) => void; pairingAddresses?: () => string[] };
export const SUBSCRIPTION_RETURN_ACTION = "nomad-transcripts-subscription-return";
export class ChatGPTSession {
  private record: Session = { hostId: "urn:uuid:" + crypto.randomUUID() };
  private loaded = false;
  private loading?: Promise<void>;
  private starting?: Promise<void>;
  private renewing?: Promise<void>;
  private finishing?: Promise<void>;
  private disconnecting = false;
  private server?: import("node:http").Server;
  private timer?: ReturnType<typeof setTimeout>;
  private pairingHost?: DesktopPairingHost;
  private pairingPoll?: ReturnType<typeof setTimeout>;
  status = "Not connected";
  constructor(private app: any, private changed: () => void, private dependencies: Dependencies = {}) {}
  get connected() { return !!this.record.tokens; }
  get needsSignIn() { return this.record.renewalBlocked === true; }
  get pairingPending() { return Boolean(this.record.pending?.pairing); }
  get email() { return this.record.email; }
  get pairing() { const value = this.pairingHost?.state; return value?.code ? value : undefined; }
  private get secrets() { return this.app.secretStorage; }
  private async secureStorage() {
    const s = this.secrets;
    if (!s || typeof s.isEncryptionAvailable !== "function" || typeof s.getSecret !== "function" ||
        typeof s.setSecret !== "function" || await s.isEncryptionAvailable() !== true)
      throw Error("Encrypted Obsidian secret storage is required for ChatGPT sign-in.");
    return s;
  }
  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loading) this.loading = (async () => {
      const secrets = await this.secureStorage();
      const saved = secrets.getSecret(SECRET);
      if (saved !== undefined && saved !== null && saved !== "") {
        if (typeof saved !== "string") throw Error("Invalid saved secure session.");
        this.record = storedSession(JSON.parse(saved));
      }
      this.loaded = true;
      this.status = this.record.renewalBlocked ? "Session renewal uncertain. Sign in again." :
        this.connected ? "ChatGPT plan connected" : "Not connected";
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  async initialize() {
    try { await this.load(); }
    catch { this.status = "Secure sign-in storage unavailable or invalid. Disconnect to reset this session."; }
    this.changed();
    if (Platform.isAndroidApp && this.record.pending?.pairing && !this.record.pending.used)
      this.schedulePairingPoll();
  }
  private async persist(record = this.record) {
    const secrets = await this.secureStorage();
    await secrets.setSecret(SECRET, JSON.stringify(record));
  }
  private setStatus(s: string) { this.status = s; this.changed(); }
  private async native(url: string, method = "GET", body?: string, headers: Record<string, string> = {}) {
    try { return await (this.dependencies.request ?? requestUrl)({ url, method, body, headers, throw: false }); }
    catch { throw Error("ChatGPT connection interrupted. No automatic request retry."); }
  }
  private async pairingRequest(url: string, method = "GET", body?: string, headers: Record<string, string> = {}) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.native(url, method, body, headers),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error("Desktop pairing timed out. Check Wi-Fi and keep desktop Obsidian open.")), 10000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
  private async discovery() {
    const r = await this.native(ISSUER + "/.well-known/openid-configuration");
    const trusted = (value: unknown) => {
      if (typeof value !== "string") return false;
      try { const url = new URL(value); return url.origin === ISSUER && !url.username && !url.password; }
      catch { return false; }
    };
    if (r.status !== 200 || r.json?.issuer !== ISSUER || !trusted(r.json.jwks_uri) || !trusted(r.json.revocation_endpoint))
      throw Error("OpenAI identity discovery unavailable.");
    return r.json;
  }
  signIn(): Promise<void> {
    if (!this.starting) this.starting = this.startSignIn().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  startDesktopPairing(): Promise<void> {
    if (!this.starting) this.starting = this.startPairingHost().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async startPairingHost() {
    if (Platform.isAndroidApp) throw Error("Start pairing in desktop Obsidian.");
    await this.load();
    if (this.renewing || this.finishing || this.disconnecting || this.server)
      throw Error("Finish the current account operation first.");
    this.pairingHost?.close();
    const host = new DesktopPairingHost({
      http: this.dependencies.http,
      addresses: this.dependencies.pairingAddresses,
      openUrl: this.dependencies.openUrl ?? ((url: string) => { window.open(url); }),
      changed: () => this.changed(),
    });
    this.pairingHost = host;
    try { await host.start(); }
    catch (error) { host.close(); this.pairingHost = undefined; this.changed(); throw error; }
    this.changed();
  }
  stopDesktopPairing() {
    this.pairingHost?.close(); this.pairingHost = undefined; this.changed();
  }
  async cancelPairing() {
    await this.load();
    if (this.starting || this.finishing || this.renewing || this.disconnecting)
      throw Error("Wait for the current sign-in check to finish, then cancel.");
    this.closeCallback();
    if (this.record.pending?.pairing) {
      const next = { ...this.record, pending: undefined };
      await this.persist(next); this.record = next;
    }
    this.setStatus(this.needsSignIn ? "Session renewal uncertain. Sign in again." : this.connected ? "ChatGPT plan connected" : "Not connected");
  }
  pairWithDesktop(address: string, code: string): Promise<void> {
    if (!this.starting) this.starting = this.startPairWithDesktop(address, code).finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async startPairWithDesktop(address: string, code: string) {
    if (!Platform.isAndroidApp) throw Error("Join desktop pairing from the Nomad.");
    await this.load();
    if (this.renewing || this.finishing || this.disconnecting) throw Error("Finish the current account operation first.");
    const origin = pairingAddress(address), key = normalizePairingCode(code);
    this.closeCallback();
    const info = await this.pairingRequest(origin + "/info");
    if (info.status !== 200 || info.json?.v !== 1 ||
        typeof info.json.sid !== "string" || !/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(info.json.sid) ||
        !Number.isFinite(info.json.expiresIn) || info.json.expiresIn <= 0 || info.json.expiresIn > 600)
      throw Error("Desktop pairing is unavailable or expired. Start pairing again on desktop.");
    const auth = await begin(this.record);
    const pairing = { address: origin, code: key, sid: info.json.sid, expiresAt: Math.min(auth.pending.created + 600000, Date.now() + info.json.expiresIn * 1000) };
    this.record.pending = { ...auth.pending, pairing }; await this.persist();
    try {
      const envelope = await sealPairing(key, pairing.sid, "request", { url: auth.url });
      const reply = await this.pairingRequest(origin + "/request", "POST", JSON.stringify(envelope), { "Content-Type": "application/json" });
      if (reply.status !== 200) throw Error("Pairing was not accepted. Check the address and pairing code.");
      const accepted = await openPairing(key, pairing.sid, "request-reply", reply.json);
      if (accepted.status !== "accepted") throw Error("Desktop pairing could not be verified.");
      this.setStatus("Approve ChatGPT sign-in in your desktop browser. Keep Obsidian open on both devices.");
      this.schedulePairingPoll();
    } catch (error) {
      this.setStatus("Desktop pairing did not connect. Check the address and code, then try again.");
      throw error;
    }
  }
  private schedulePairingPoll() {
    if (this.pairingPoll) clearTimeout(this.pairingPoll);
    this.pairingPoll = setTimeout(() => {
      this.pairingPoll = undefined;
      void this.finish().then(() => {
        if (this.record.pending?.pairing && !this.record.pending.used) this.schedulePairingPoll();
      }).catch(() => { this.setStatus("Pairing needs attention. Keep desktop Obsidian open, then choose Finish sign-in or start pairing again."); });
    }, 2000);
  }
  private async finishDesktopPairing() {
    const pending = this.record.pending, pairing = pending?.pairing;
    if (!pairing || pending.used || Date.now() > pairing.expiresAt || Date.now() - pending.created > 600000)
      throw Error("Desktop pairing expired or was already used. Start a fresh pairing.");
    const request = await sealPairing(pairing.code, pairing.sid, "poll", { op: "poll" });
    const reply = await this.pairingRequest(pairing.address + "/result", "POST", JSON.stringify(request), { "Content-Type": "application/json" });
    if (reply.status !== 200) throw Error("Desktop pairing is unavailable. Check that desktop Obsidian is open.");
    const result = await openPairing(pairing.code, pairing.sid, "poll-reply", reply.json);
    if (result.status === "waiting") return;
    if (result.status !== "ready" || !result.result) throw Error("Desktop sign-in return could not be verified.");
    await this.complete(result.result);
    // The desktop receives only a one-use OAuth code. Tokens stay on the Nomad.
    // A failed acknowledgement is harmless: the relay expires and cannot redeem it.
    try {
      const ack = await sealPairing(pairing.code, pairing.sid, "ack", { op: "ack" });
      await this.pairingRequest(pairing.address + "/ack", "POST", JSON.stringify(ack), { "Content-Type": "application/json" });
    } catch { /* The completed encrypted session remains valid. */ }
  }
  private async startSignIn() {
    await this.load();
    if (this.renewing || this.finishing || this.disconnecting) throw Error("Finish the current account operation first.");
    // An explicit Connect action always starts a fresh authorization attempt.
    // This replaces any pending state and invalidates callbacks from an older
    // browser/helper flow, including after an app reload.
    this.closeCallback();
    const auth = await begin(this.record);
    const open = this.dependencies.openUrl ?? ((url: string) => { window.open(url); });
    try {
      if (Platform.isAndroidApp) {
        this.record.pending = auth.pending; await this.persist();
        // A helper that supports return routing can target production separately
        // from the prototype. Existing helpers ignore return; production also
        // registers their legacy callback once the test plugin is removed.
        open("supernote-login-helper://start?authorization=" + encodeURIComponent(auth.url) +
          "&return=" + encodeURIComponent("obsidian://" + SUBSCRIPTION_RETURN_ACTION));
      } else {
        const http = (this.dependencies.http ?? (() => require("http")))() as typeof import("node:http");
        const pending: any = auth.pending;
        this.server = http.createServer((req, res) => {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Referrer-Policy", "no-referrer");
          const reject = (code: number, message: string) => { res.writeHead(code); res.end(message); };
          if (req.headers.host !== "127.0.0.1:19456" || req.method !== "GET" ||
              req.socket.remoteAddress !== "127.0.0.1") { reject(403, "Forbidden"); return; }
          let u: URL;
          try { u = new URL(req.url ?? "/", "http://127.0.0.1:19456"); }
          catch { reject(400, "Invalid sign-in return"); return; }
          if ((req.url?.length ?? 0) > 16384 || u.origin !== "http://127.0.0.1:19456" ||
              u.pathname !== "/auth/callback" || u.searchParams.get("state") !== pending.state ||
              this.record.pending?.state !== pending.state ||
              [...u.searchParams.keys()].some((key) => u.searchParams.getAll(key).length !== 1)) {
            reject(400, "Invalid sign-in return"); return;
          }
          if (this.finishing || pending.used) { reject(409, "Sign-in return already received"); return; }
          this.finishing = this.complete(Object.fromEntries(u.searchParams))
            .catch(() => { this.setStatus("Sign-in could not be verified. Start a fresh attempt."); })
            .finally(() => { this.finishing = undefined; this.closeCallback(); });
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Return to Obsidian to finish connecting.");
        });
        const server = this.server;
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(19456, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
        });
        server.on("error", () => { this.closeCallback(); this.setStatus("Sign-in callback unavailable. Start a fresh attempt."); });
        this.record.pending = pending; await this.persist();
        this.timer = setTimeout(() => { this.closeCallback(); this.setStatus("Sign-in expired. Start a fresh attempt."); }, 600000);
        open(auth.url);
      }
      this.setStatus(Platform.isAndroidApp
        ? "After browser sign-in, return to Supernote Transcripts and choose Finish sign-in."
        : "Continue with ChatGPT in your browser.");
    } catch (error) {
      this.closeCallback(); this.record.pending = undefined; await this.persist(); throw error;
    }
  }
  async finish() {
    await this.load();
    if (this.starting || this.renewing || this.disconnecting) throw Error("Finish the current account operation first.");
    if (this.finishing) return this.finishing;
    if (!this.record.pending || !Platform.isAndroidApp) return;
    this.finishing = (async () => {
      if (this.record.pending?.pairing) { await this.finishDesktopPairing(); return; }
      const r = await this.native("http://127.0.0.1:19456/result", "GET", undefined, { "X-Callback-State": this.record.pending.state });
      if (r.status === 202) return;
      if (r.status !== 200) throw Error("Sign-in return unavailable. Start a fresh sign-in.");
      await this.complete(r.json);
    })().finally(() => { this.finishing = undefined; });
    return this.finishing;
  }
  private async complete(result: any) {
    const pending = this.record.pending;
    const form = exchangeForm(pending, result);
    // Persist consumption before exchanging a one-use authorization code.
    await this.persist();
    const token = await this.native(ISSUER + "/api/accounts/oauth/token", "POST", form.body, { "Content-Type": "application/x-www-form-urlencoded" });
    if (token.status !== 200) throw Error("ChatGPT sign-in exchange failed.");
    const tokens = credentials(token.json);
    const d = await this.discovery(), keys = await this.native(d.jwks_uri);
    if (keys.status !== 200) throw Error("OpenAI signing keys unavailable.");
    const who = await identity(token.json.id_token, keys.json, form.clientId, pending.nonce, this.record.subject);
    const next = { ...this.record, ...who, clientId: form.clientId, tokens, pending: undefined, renewalBlocked: undefined };
    await this.persist(next); this.record = next; this.setStatus("ChatGPT plan connected");
  }
  async access(): Promise<string> {
    await this.load();
    await this.secureStorage();
    if (this.starting || this.finishing || this.disconnecting) throw Error("Finish the current account operation first.");
    if (!this.record.tokens) throw Error("Connect your ChatGPT plan in settings first.");
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw Error("Offline. Connect to the internet, then continue recognition.");
    // Waiting callers must join the same rotation before considering its stop marker.
    if (this.renewing) await this.renewing;
    if (this.record.renewalBlocked) throw Error("Session renewal uncertain. Sign in again.");
    if (this.record.tokens.expiresAt <= Date.now() + 120000) {
      if (!this.renewing) this.renewing = (async () => {
        if (this.record.tokens.earliestRefreshAt > Date.now()) throw Error("Session renewal is not yet available.");
        this.record.renewalBlocked = true; await this.persist();
        try {
          const r = await this.native(ISSUER + "/api/accounts/oauth/token", "POST", refreshForm(this.record), { "Content-Type": "application/x-www-form-urlencoded" });
          if (r.status !== 200) throw Error("ChatGPT session renewal failed. Sign in again.");
          const tokens = credentials(r.json);
          if (r.json.id_token) {
            const d = await this.discovery(), keys = await this.native(d.jwks_uri);
            if (keys.status !== 200) throw Error("OpenAI signing keys unavailable.");
            await identity(r.json.id_token, keys.json, this.record.clientId, undefined, this.record.subject);
          }
          const next = { ...this.record, tokens, renewalBlocked: undefined };
          await this.persist(next); this.record = next; this.setStatus("ChatGPT plan connected");
        } catch (error) { this.setStatus("Session renewal uncertain. Sign in again."); throw error; }
      })().finally(() => { this.renewing = undefined; });
      await this.renewing;
    }
    return this.record.tokens.accessToken;
  }
  async models() {
    const r = await this.native(RESOURCE + "/models", "GET", undefined, { Authorization: "Bearer " + await this.access() });
    if (r.status !== 200) throw Error("ChatGPT model list unavailable. Custom models remain selectable.");
    return catalogModels(r.json).map((m: any) => ({ id: m.slug, name: m.name }));
  }
  async recognize(model: string, image: string, instructions: string, beforeSend: () => boolean | Promise<boolean>, options?: { images: {label:string;image:string}[]; reasoningEffort?:string; maxOutputTokens:number; textOnly?:boolean }) {
    if (typeof model !== "string" || !model.trim() || /[\u0000-\u001f]/.test(model) ||
        typeof instructions !== "string" || typeof beforeSend !== "function")
      throw new RecognitionFailure("provider", "Invalid subscription page request configuration.", { scope: "source" });
    for(const item of options?.images??[{label:"",image}])if(typeof item.label!=="string"||typeof item.image!=="string"||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.image)||item.image.length>16000000)throw new RecognitionFailure("render","Invalid subscription page request image.");
    if (options?.textOnly !== true && (typeof image !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 16000000))
      throw new RecognitionFailure("render", "Invalid subscription page request image. Retry this page or skip it.");
    // Build/serialize before reserving so validation cannot consume a reservation.
    const body = JSON.stringify({ model, store: false, stream: true, ...(options?{max_output_tokens:options.maxOutputTokens,...(options.reasoningEffort?{reasoning:{effort:options.reasoningEffort}}:{})}:{}), input: [{ role: "user", content: [
      { type: "input_text", text: instructions }, ...(options?options.images.flatMap(item=>[{type:"input_text",text:item.label},{type:"input_image",image_url:item.image,detail:"original"}]):[{ type: "input_image", image_url: image, detail: "high" }]),
    ] }] });
    let token: string;
    try { token = await this.access(); }
    catch (error) { throw new RecognitionFailure("provider", error instanceof Error ? error.message : "Reconnect your ChatGPT account.", { scope: "batch", code: typeof navigator !== "undefined" && navigator.onLine === false ? "subscription_offline" : this.needsSignIn || !this.connected ? "subscription_auth" : "subscription_preflight" }); }
    if (await beforeSend() !== true) return null;
    let r;
    try { r = await this.native(RESOURCE + "/responses", "POST", body, { Authorization: "Bearer " + token, "Content-Type": "application/json" }); }
    catch { throw new RecognitionFailure("transport", "The ChatGPT connection ended before this page's response could be confirmed. Retry this page explicitly or skip it; no automatic request retry."); }
    if (r.status !== 200) throw providerFailure(r.status, r.json);
    return completedText(r.text);
  }
  async disconnect() {
    if (this.starting || this.renewing || this.finishing || this.disconnecting) throw Error("Finish the current account operation first.");
    this.disconnecting = true;
    try {
      await this.secureStorage();
      try { await this.load(); } catch { this.record = { hostId: "urn:uuid:" + crypto.randomUUID() }; }
      let revoked = true;
      if (this.connected) try {
        const d = await this.discovery();
        revoked = (await this.native(d.revocation_endpoint, "POST", new URLSearchParams({ token: this.record.tokens.refreshToken, token_type_hint: "refresh_token", client_id: this.record.clientId! }).toString(), { "Content-Type": "application/x-www-form-urlencoded" })).status === 200;
      } catch { revoked = false; }
      const next = { hostId: this.record.hostId, clientId: this.record.clientId };
      await this.persist(next); this.record = next; this.loaded = true; this.closeCallback();
      this.setStatus(revoked ? "Disconnected" : "Disconnected locally; remove this app in ChatGPT Settings to confirm revocation.");
    } finally { this.disconnecting = false; }
  }
  closeCallback() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.pairingPoll) clearTimeout(this.pairingPoll); this.pairingPoll = undefined;
    this.pairingHost?.close(); this.pairingHost = undefined;
    this.server?.close(); this.server = undefined;
  }
}
