import { Plugin, Platform, requestUrl, Notice } from "obsidian";
import type {
  ConfigV1,
  Profile,
  NotebookState,
  Store,
  Progress,
  SourceEntry,
  Controller,
  FolderRule,
  NotebookChoice,
  QueueView,
} from "./types";
import { AndroidReadOnlySource } from "./reader";
import { DesktopReadOnlySource } from "./desktop-reader";
import { SharedNotebookCache, notebookIdentity, isSharedPath, type SharedIO, type LeaseHandle } from "./shared";
import { MirrorCatalog, mirrorFingerprint, type PortableMirror } from "./catalog";
import { portableMirrorEqual, reconcileMirror } from "./mirror-sync";
import { ChatGPTSession } from "./subscription";
import { advertise as advertisePairing, discover as discoverPairing } from "./subscription-pairing-discovery";
import { SubscriptionUsage } from "./subscription-usage";
import { encodeStateSnapshot, loadStateSlots, STATE_STORAGE_BLOCK } from "./state";
import { interruptedAttempts } from "./attempt-recovery.mjs";
import { RecognitionFailure, isRecognitionFailure, completedResponse, normalizePageText, isEmptyPage, providerFailure } from "./subscription-stream.mjs";
import { GENERAL_TRANSCRIPTION_PROMPT, TRANSCRIPTION_RESPONSE_RULES, GROUP_RESPONSE_RULES, recognitionPrompt } from "./prompts.mjs";
import { qualitySettings, planRecognitionGroups, contextPages } from "./quality.mjs";
import { cleanupInput, cleanupPages } from "./cleanup.mjs";
import { pageTextLayer } from "./provenance.mjs";
import { runWorkers } from "./workers.mjs";
import { PublicationReceipts, canAdvancePublication, canAdoptPublication, type Receipt } from "./publication";
import { hydratePublicationCache } from "./publication-cache";
import { installUI } from "./ui";
import { installPageLinks } from "./page-links-ui";
import { resolveNotePage, notePageUrl, isManagedTranscript } from "./page-navigation";
import { OriginalPagePreview } from "./page-preview";
import { responseText, pagesFromRange, selectedPageNumbers, documentText } from "./core.mjs";
import { BudgetBlocked, CostBook, priceFor, endpointKey, recognitionOutputAllowance } from "./cost";
import type { CostSettings } from "./cost";
import {
  parseRecognitionGroup,
  validateSource,
  validateDestination,
  ruleFor,
  mirrorPath,
  excluded,
  reconcilePages,
  pendingPages,
  recognizeRename,
  buildMarkdown,
  profileNeedsRefresh,
  relativeToRule,
  orderedTasks,
  literalExclusion,
} from "./reconcile.mjs";

const GENERAL_PROMPT = GENERAL_TRANSCRIPTION_PROMPT;
const DEFAULT_PROFILE: Profile = {
  id: "general",
  name: "General — no glossary",
  model: "gpt-6.1-sol",
  endpoint: "https://api.openai.com/v1/responses",
  prompt: GENERAL_PROMPT,
  glossaries: [],
  quality: "balanced",
};
const freshConfig = (): ConfigV1 => ({
  version: 1,
  profiles: [{ ...DEFAULT_PROFILE, glossaries: [] }],
  rules: [],
  intervalMinutes: 5,
  batchPages: 4,
  continuous: true,
  showPageHeadings: false,
});
const freshStore = (): Store => ({
  version: 1,
  notebooks: {},
  queue: [],
  history: [],
});
const emptyProgress = (): Progress => ({
  stage: "Ready",
  detail: "Choose sources in settings, then update.",
  checked: 0,
  total: 0,
  recognized: 0,
  reused: 0,
  pending: 0,
  running: false,
  paused: false,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const readable = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
// Older journals stored only the display message. Keep this migration narrow:
// reconnecting must never release quota, spending or ambiguous page holds.
const subscriptionAuthStop = (reason?: string, code?: string) => code === "subscription_auth" || !code &&
  /^(?:Session renewal uncertain\. Sign in again\.|ChatGPT session renewal failed\. Sign in again\.|Connect your ChatGPT plan in settings first\.|ChatGPT connection interrupted\. No automatic request retry\.)$/.test(reason ?? "");
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default class SupernoteTranscripts extends Plugin implements Controller {
  config = freshConfig();
  store = freshStore();
  progress = emptyProgress();
  private listeners = new Set<() => void>();
  private generation = 0;
  private stateStorageIssue?: string;
  private stateEstablished = false;
  private writes: Promise<void> = Promise.resolve();
  private task: Promise<unknown> | null = null;
  private pageNavigation?: Promise<void>;
  private stop = false;
  private disposed = false;
  private scanSources = new Set<string>();
  private callsThisRun = 0;
  private nativeActive = true;
  private initializing = true;
  private boundMirrors = new Set<string>();
  sharedSettingsIssues: { ruleId: string; name: string; fields: string[]; reason: string }[] = [];
  private settingsWork: Promise<void> = Promise.resolve();
  private sharedSettingsTimer?: ReturnType<typeof setTimeout>;
  private sharedCache?: SharedNotebookCache;
  private chatGPT?: ChatGPTSession;
  private planUsage?: SubscriptionUsage;
  private recipes = new Map<string,string>();
  private automaticRun = false;
  pageLinks?: any;
  get platform(): "desktop" | "nomad" { return Platform.isAndroidApp ? "nomad" : "desktop"; }
  get concurrency() { const n=Number(localStorage.getItem(`${this.devicePrefix}:workers`)); return Number.isInteger(n)&&n>=1 ? Math.min(n,32) : this.platform==="nomad"?1:4; }
  set concurrency(n:number) { if(!Number.isInteger(n)||n<1||n>32)throw Error("Choose between 1 and 32 simultaneous requests.");localStorage.setItem(`${this.devicePrefix}:workers`,String(n));this.emit(); }
  get provider(): "api" | "subscription" { return localStorage.getItem(`${this.devicePrefix}:provider`)==="subscription"?"subscription":"api"; }
  set provider(value:"api"|"subscription") { if(this.task)throw Error("Pause and wait for active requests before changing provider."); localStorage.setItem(`${this.devicePrefix}:provider`,value);this.emit(); }
  get showPageHeadings() { return this.config.showPageHeadings!==false; }
  set showPageHeadings(value:boolean) { this.config.showPageHeadings=value;for(const s of Object.values(this.store.notebooks))if(this.sourceSelected(s.source)&&!["missing","conflict"].includes(s.status))this.enqueue(s.source);this.emit(); }
  private subscriptionRecovery?: Promise<void>;
  private get session() { return this.chatGPT??=new ChatGPTSession(this.app,()=>{
    this.emit();
    void this.recoverSubscriptionConnection().catch(() => this.emit());
  }); }
  private recoverSubscriptionConnection(): Promise<void> {
    if(this.subscriptionRecovery)return this.subscriptionRecovery;
    if(this.disposed||this.task||this.stateStorageIssue||this.provider!=="subscription"||
      !this.chatGPT?.connected||this.chatGPT.needsSignIn||this.chatGPT.status!=="ChatGPT plan connected")return Promise.resolve();
    const states=Object.values(this.store.notebooks).filter(s=>s.executionIssue?.scope==="batch"&&
      (subscriptionAuthStop(s.executionIssue.reason,s.executionIssue.code)||
        s.executionIssue.code==="subscription_offline"&&(typeof navigator==="undefined"||navigator.onLine!==false)));
    const blocked=this.progress.executionBlocked;
    const clearProgress=subscriptionAuthStop(blocked)||states.some(s=>s.executionIssue?.reason===blocked);
    if(!states.length&&!clearProgress)return Promise.resolve();
    this.subscriptionRecovery=(async()=>{
      for(const state of states){
        const reason=state.executionIssue!.reason;
        delete state.executionIssue;
        if(state.error===reason)delete state.error;
        if(state.status==="failed")state.status=pendingPages(state).length?"queued":Object.keys(state.pageIssues??{}).length?"partial":"current";
        if(this.sourceSelected(state.source)&&!["missing","conflict","excluded"].includes(state.status)&&
          !state.legacyPageFailure&&pendingPages(state).length)this.enqueue(state.source);
      }
      if(clearProgress){
        this.progress.executionBlocked=Object.values(this.store.notebooks).find(s=>s.executionIssue?.scope==="batch")?.executionIssue?.reason;
        if(this.progress.detail===blocked)this.progress.detail=this.progress.paused
          ? "ChatGPT is connected. Saved pages are preserved; resume when ready."
          : "ChatGPT is connected. Pending pages can continue with your update settings.";
      }
      if(states.length)await this.persist();
      this.emit();
    })().finally(()=>{this.subscriptionRecovery=undefined;});
    return this.subscriptionRecovery;
  }
  get subscriptionStatus(){return {connected:this.session.connected,needsSignIn:this.session.needsSignIn,pairingPending:this.session.pairingPending,status:this.session.status,email:this.session.email};}
  private get subscriptionBook(){return this.planUsage??=new SubscriptionUsage(localStorage,`${this.devicePrefix}:subscription-usage-v1`);}
  get subscriptionUsage(){return {...this.subscriptionBook.snapshot(),dailyLimit:this.costs.settings.dailyRequests};}
  async connectSubscription(){if(this.task)throw Error("Finish active recognition before connecting an account.");await this.session.signIn();}
  get subscriptionPairing(){return this.session.pairing;}
  async startSubscriptionPairing(){
    if(this.task)throw Error("Pause and wait for recognition before pairing a Nomad.");
    await this.session.startDesktopPairing();
    const state=this.session.pairing,io=this.sharedIO();
    const deviceId=this.shared?.deviceId;
    if(state&&io&&deviceId)try {await advertisePairing(io,state,deviceId);}catch{
      new Notice("Pairing is ready. Desktop discovery could not be shared; enter its address manually.");
    }
  }
  async discoverSubscriptionDesktops(){
    const io=this.sharedIO();
    if(!io)throw Error("Desktop discovery needs the same synced vault on both devices. You can enter its address manually.");
    return discoverPairing(io,url=>requestUrl({url,throw:false}));
  }
  async stopSubscriptionPairing(){this.session.stopDesktopPairing();}
  async cancelSubscriptionPairing(){await this.session.cancelPairing();}
  async pairSubscriptionDesktop(address:string,code:string){if(this.task)throw Error("Pause and wait for recognition before signing in.");await this.session.pairWithDesktop(address,code);}
  async finishSubscriptionLogin(){await this.session.finish();}
  async disconnectSubscription(){if(this.task)throw Error("Pause and wait for active requests before disconnecting.");await this.session.disconnect();}
  async listModels(){
    if(this.provider==="subscription")return this.session.models();
    const endpoint=this.config.profiles[0]?.endpoint??DEFAULT_PROFILE.endpoint;
    const url=new URL(endpointKey(endpoint));url.pathname=url.pathname.replace(/\/responses$/, "/models");
    if(!this.apiKey)throw Error("Add an API key before refreshing models.");
    const r=await requestUrl({url:url.toString(),headers:{Authorization:`Bearer ${this.apiKey}`},throw:false});
    if(r.status!==200||!Array.isArray(r.json?.data))throw Error("Model list unavailable. Use Custom to enter a model.");
    return r.json.data.filter((m:any)=>typeof m.id==="string").map((m:any)=>({id:m.id,name:m.id}));
  }
  private sharedIO(): SharedIO | undefined {
    const a=this.app.vault.adapter;
    if(!a.list)return undefined;
    return {exists:p=>a.exists(p),read:p=>a.read(p),write:(p,t)=>a.write(p,t),create:(p,t)=>this.app.vault.create(p,t),list:p=>a.list(p),mkdir:p=>this.app.vault.createFolder(p)};
  }
  private get shared(){
    const io=this.sharedIO();if(!io)return undefined;
    let id=localStorage.getItem(`${this.devicePrefix}:device-id`);
    if(!id){id=crypto.randomUUID();localStorage.setItem(`${this.devicePrefix}:device-id`,id);}
    return this.sharedCache??=new SharedNotebookCache(io,id);
  }
  async listSharedMirrors(){const io=this.sharedIO();return io?(await new MirrorCatalog(io).list()).map(m=>({id:m.id,name:m.name})):[];}
  async exportSavedResults(){
    if(this.task)throw Error("Wait for active recognition before sharing saved results.");
    const shared=this.shared,io=this.sharedIO();if(!shared||!io)return 0;
    let count=0;
    for(const state of Object.values(this.store.notebooks)){
      const rule=ruleFor(state.source,this.config.rules);if(!rule||!this.sourceSelected(state.source))continue;
      const id=await notebookIdentity(rule.sharedId??rule.id,relativeToRule(state.source,rule));
      for(const page of state.desired){
        const result=state.pages[page.id];if(!result?.text||result.fingerprint!==page.fingerprint||!/^[a-f0-9]{64}$/.test(result.recipe))continue;
        const query={notebookId:id,pageId:page.id,fingerprint:page.fingerprint,recipe:result.recipe};
        if(!(await shared.findResult(query)).chosen){await shared.saveResult(query,result.text,result.recognition);count++;}
      }
      if(state.publishedHash&&await io.exists(state.output)){
        const text=await io.read(state.output);
        if(await hash(text)===state.publishedHash)await new PublicationReceipts(io).save(id,text,state.desired,state.pages,this.presentationFor(state));
      }
    }
    return count;
  }
  queueEstimate(source?:string, selectedNumbers?:number[]){
    const states=Object.values(this.store.notebooks).filter(s=>(!source||s.source===source)&&this.sourceSelected(s.source));
    let requests=0,pages=0,usd=0,seconds=0,samples=0,priced=true,timed=true,provisional=false;
    const sampled=new Set<string>();
    for(const s of states){
      const pending=selectedNumbers?s.desired.filter(p=>selectedNumbers.includes(p.number)):pendingPages(s);
      const n=!selectedNumbers&&(s.legacyPageFailure||s.executionIssue)?0:pending.length;
      if(!n)continue;pages+=n;
      const rule=ruleFor(s.source,this.config.rules),p=this.config.profiles.find(p=>p.id===rule?.profileId);if(!p){priced=false;timed=false;continue;}
      const groups=planRecognitionGroups(pending,s.desired,p.quality);requests+=groups.length;
      const recipe=this.recipes.get(p.id);
      const avg=this.provider==="subscription"?this.subscriptionBook.average(p.model,recipe??"not-yet-resolved"):this.costBook.average(p.endpoint,p.model,recipe??"not-yet-resolved");
      const context=JSON.stringify([this.provider,p.endpoint,p.model,recipe]);if(!sampled.has(context)){sampled.add(context);samples+=avg.samples;}
      if(avg.seconds!==undefined)seconds+=avg.seconds*n/this.concurrency;else timed=false;
      if(this.provider==="api"){
        const cost=(avg as {usd?:number}).usd;
        if(cost!==undefined)usd+=cost*n;
        else{const price=priceFor(p.endpoint,p.model,this.costs.settings);provisional=true;if(price)usd+=groups.reduce((sum,g)=>sum+(3000*(g.length+contextPages(g,s.desired,p.quality).length)*price.input+(1000*g.length+(qualitySettings(p.quality).mode==="careful"?4000:qualitySettings(p.quality).mode==="balanced"?2000:0))*price.output)/1e6,0);else priced=false;}
      }
    }
    return {pages,usd:this.provider==="api"&&priced?usd:undefined,reservationUsd:this.provider==="api"?(source?this.costs.notebooks.find(n=>n.source===source)?.heldUsd??0:this.costs.total.heldUsd):undefined,samples,provisional:provisional||!samples,seconds:timed?seconds:undefined,requests};
  }
  private spending?: CostBook;
  private get costBook() {
    return (this.spending ??= new CostBook(
      localStorage,
      `${this.devicePrefix}:spending-v1`,
    ));
  }
  get costs() {
    return this.costBook.snapshot();
  }
  async saveCostSettings(settings: CostSettings) {
    this.costBook.saveSettings(settings);
    this.progress.budgetBlocked = undefined;
    this.emit();
  }
  async resolveUnconfirmedCosts() {
    if (this.provider === "subscription") this.subscriptionBook.resolve();
    else this.costBook.resolveUnconfirmed();
    this.progress.budgetBlocked = undefined;
    this.emit();
  }
  private get active() {
    if (Platform.isAndroidApp) return this.nativeActive && !document.hidden;
    // Obsidian keeps the focused popout's document in this SDK global even
    // when the main plugin window is minimized or hidden.
    const current = typeof activeDocument !== "undefined" && activeDocument ? activeDocument : document;
    return !current.hidden;
  }
  private get devicePrefix() {
    return `nomad-transcripts:${this.app.vault.getName()}`;
  }
  get apiKey() {
    return (
      localStorage.getItem(
        `nomad-transcripts-key:${this.app.vault.getName()}`,
      ) ?? ""
    );
  }
  set apiKey(value: string) {
    value.trim()
      ? localStorage.setItem(
          `nomad-transcripts-key:${this.app.vault.getName()}`,
          value.trim(),
        )
      : localStorage.removeItem(
          `nomad-transcripts-key:${this.app.vault.getName()}`,
        );
  }
  get autoEnabled() {
    return localStorage.getItem(`${this.devicePrefix}:auto`) === "true";
  }
  get aiEnabled() {
    return localStorage.getItem(`${this.devicePrefix}:ai`) !== "false";
  }
  set aiEnabled(value: boolean) {
    localStorage.setItem(`${this.devicePrefix}:ai`, String(value));
    this.emit();
  }
  set autoEnabled(value: boolean) {
    localStorage.setItem(`${this.devicePrefix}:auto`, String(value));
    this.emit();
  }
  private get storageFolder() {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    this.progress.pending = this.store.queue.length;
    for (const listener of this.listeners) listener();
  }
  private stage(stage: string, detail: string) {
    this.progress.stage = stage;
    this.progress.detail = detail;
    this.emit();
  }
  private reader(reportProgress = true) {
    const progress = reportProgress ? (stage: string, detail: string) => this.stage(stage, detail) : undefined;
    if (!Platform.isAndroidApp) return new DesktopReadOnlySource(undefined,progress);
    const fs = (this.app.vault.adapter as any).fs;
    if (!fs?.stat || !fs?.readdir || !fs?.getUri)
      throw new Error(
        "This Obsidian version has no compatible Android file interface.",
      );
    return new AndroidReadOnlySource(fs, progress);
  }
  async onload() {
    const data = await this.loadData();
    if(this.platform==="desktop"&&localStorage.getItem(`${this.devicePrefix}:ai`)===null){
      localStorage.setItem(`${this.devicePrefix}:ai`,"false");localStorage.setItem(`${this.devicePrefix}:auto`,"false");localStorage.setItem(`${this.devicePrefix}:paused`,"true");
    }
    const loaded = await loadStateSlots(this.app.vault.adapter, this.storageFolder);
    if (loaded.snapshot) {
      this.store = loaded.snapshot.store;
      this.generation = loaded.snapshot.generation;
      this.stateEstablished = true;
    }
    this.stateEstablished ||= data?.stateInitialized === true;
    if (loaded.blocked || (!loaded.snapshot && this.stateEstablished)) this.blockState(loaded.blocked ?? STATE_STORAGE_BLOCK);
    if (data?.config?.version === 1)
      this.config = { ...freshConfig(),showPageHeadings:true, ...data.config };
    else if (data?.config && !this.stateStorageIssue) await this.migratePrototype(data);
    let migratedFailure = false;
    for (const state of Object.values(this.store.notebooks)) {
      if (state.status === "recognizing" || state.status === "checking")
        state.status = "queued";
      if(state.status==="failed"&&!Object.keys(state.pageIssues??{}).length&&!state.legacyPageFailure&&!state.executionIssue&&
          /stream.*(?:complete|finish)|AI response.*(?:incomplete|empty)|connection.*interrupted|AI request failed.*HTTP 5\d\d/i.test(state.error??"")){
        state.legacyPageFailure=state.error; migratedFailure=true;
      }
    }
    this.progress.executionBlocked=Object.values(this.store.notebooks).find(s=>s.executionIssue?.scope==="batch")?.executionIssue?.reason;
    if(migratedFailure&&!this.stateStorageIssue)await this.persist();
    this.progress.paused =
      localStorage.getItem(`${this.devicePrefix}:paused`) === "true";
    this.stop = this.progress.paused;
    this.boundMirrors = new Set(this.config.rules.map(r=>r.sharedId).filter(Boolean) as string[]);
    await Promise.all(this.config.profiles.map(p=>this.profile(p.id).catch(()=>{this.recipes.delete(p.id);}))); 
    if(!this.stateStorageIssue)try{await this.recoverInterruptedAttempts();}catch(error){
      if(error instanceof BudgetBlocked)this.progress.budgetBlocked=readable(error);
      else if(!this.stateStorageIssue)this.progress.executionBlocked=readable(error);
    }
    void this.session.initialize();
    const finishSignInReturn = () => { void this.finishSubscriptionLogin().catch(() =>
      this.stage("Sign-in needs attention", "Finish or restart ChatGPT sign-in in settings.")); };
    this.registerObsidianProtocolHandler?.("nomad-transcripts-subscription-return", finishSignInReturn);
    // Older Android helpers return to the prototype's action. Once that test
    // plugin is removed, production owns the alias; state/PKCE checks still apply.
    if (!(this.app as any).plugins?.plugins?.["nomad-subscription-test"])
      this.registerObsidianProtocolHandler?.("nomad-subscription-return", finishSignInReturn);
    this.stage(
      this.progress.paused ? "Paused" : "Ready to continue",
      this.progress.paused
        ? "Successful pages are saved. Resume to continue."
        : this.config.rules.some((rule) => rule.enabled)
          ? "Saved results are loaded. Update now, or leave Obsidian open for automatic catch-up."
          : "Choose sources in settings, then update.",
    );
    installUI(this, this);
    const pageLinks = installPageLinks(this, async (outputPath, pageId, displayNumber) => {
      try { await this.openNotebookPage(outputPath, pageId, displayNumber); }
      catch (error) { new Notice(readable(error)); }
    }, () => localStorage.getItem(`${this.devicePrefix}:page-links`) !== "false");
    this.addCommand({
      id: "toggle-page-links", name: "Show or hide notebook page links",
      callback: () => {
        const enabled = localStorage.getItem(`${this.devicePrefix}:page-links`) === "false";
        localStorage.setItem(`${this.devicePrefix}:page-links`, String(enabled));
        pageLinks.refresh();
        new Notice(enabled ? "Notebook page links shown" : "Notebook page links hidden");
      },
    });
    const wake = () => {
      if (
        this.autoEnabled &&
        !this.disposed &&
        !this.progress.paused &&
        this.active &&
        !this.task && !this.subscriptionRecovery && !this.stateStorageIssue && !this.progress.executionBlocked && !this.progress.budgetBlocked
      )
        void this.update(true).catch((error) =>
          this.stage("Needs attention", readable(error)),
        );
    };
    this.registerDomEvent(document, "visibilitychange", wake);
    this.registerDomEvent(window, "focus", () => { this.scheduleSharedSettings(); wake(); });
    this.registerDomEvent(window, "online", () => {
      void this.recoverSubscriptionConnection().catch(() => this.emit());
    });
    const nativeApp = (window as any).Capacitor?.Plugins?.App;
    if (Platform.isAndroidApp && nativeApp?.getState) {
      try {
        this.nativeActive = (await nativeApp.getState()).isActive === true;
        const stateListener = await nativeApp.addListener(
          "appStateChange",
          ({ isActive }: { isActive: boolean }) => {
            this.nativeActive = isActive === true;
            if (this.nativeActive) wake();
          },
        );
        this.register(() => {
          void stateListener.remove().catch(() => {});
        });
        const pauseListener = await nativeApp.addListener("pause", () => {
          this.nativeActive = false;
        });
        this.register(() => {
          void pauseListener.remove().catch(() => {});
        });
      } catch {
        this.nativeActive = false;
        this.stage(
          "Waiting for Obsidian",
          "Native app state is unavailable. Reload Obsidian before continuing.",
        );
      }
    }
    let elapsed = 0;
    this.registerInterval(
      window.setInterval(() => {
        elapsed++;
        if (elapsed >= Math.max(1, Math.min(60, this.config.intervalMinutes))) {
          elapsed = 0;
          wake();
        }
      }, 60000),
    );
    this.registerInterval(window.setInterval(() => this.scheduleSharedSettings(), 30000));
    this.app.workspace.onLayoutReady(() => {
      const timer = window.setTimeout(wake, 10000);
      this.register(() => clearTimeout(timer));
    });
    if(!this.stateStorageIssue)await this.saveConfig();
    this.initializing=false;
    if(!this.stateStorageIssue)await this.refreshSharedSettings();
    if(this.app.vault.on)for(const event of ["create", "modify", "delete", "rename"] as const)
      this.registerEvent(this.app.vault.on(event as "modify", file => {
        if(file.path.startsWith("Supernote Transcripts/Shared Data/Mirrors/"))this.scheduleSharedSettings();
      }));
    this.register(() => { if(this.sharedSettingsTimer)clearTimeout(this.sharedSettingsTimer); });
    if(this.stateStorageIssue)this.stage("Saved state needs attention",this.stateStorageIssue);
    this.emit();
  }
  onunload() {
    this.disposed = true;
    this.stop = true;
    this.listeners.clear();
    this.chatGPT?.closeCallback();
  }
  async saveConfig() {
    return this.settingsOperation(async () => {
      if(!this.initializing) {
        if(this.task)for(const rule of this.config.rules)rule.sharedPending=true;
        else await this.syncMirrorSettings(true);
      }
      await this.persistSettings();
      this.emit();
    });
  }
  private settingsOperation(run: () => Promise<void>): Promise<void> {
    const operation = this.settingsWork.then(run, run);
    this.settingsWork = operation.catch(() => {});
    return operation;
  }
  private async persistSettings() {
    await this.saveData({ config: this.config, ...(this.stateEstablished?{stateInitialized:true}:{}) });
    await Promise.all(this.config.profiles.map(p=>this.profile(p.id).catch(()=>{this.recipes.delete(p.id);}))); 
  }
  private scheduleSharedSettings() {
    if(this.disposed || this.initializing)return;
    if(this.sharedSettingsTimer)clearTimeout(this.sharedSettingsTimer);
    this.sharedSettingsTimer=setTimeout(() => {
      this.sharedSettingsTimer=undefined;
      if(this.disposed)return;
      if(this.task){this.scheduleSharedSettings();return;}
      void this.refreshSharedSettings().catch(() => this.emit());
    }, 600);
  }
  private portableSettings(rule: FolderRule): PortableMirror {
    const profile=this.config.profiles.find(p=>p.id===rule.profileId);
    if(!profile)throw Error("Choose recognition settings for this source.");
    return {profile:clone(profile),output:rule.output,recursive:rule.recursive,exclude:[...rule.exclude]};
  }
  private applyPortableSettings(rule: FolderRule, value: PortableMirror, profileId: string) {
    const before=this.portableSettings(rule);
    if(!portableMirrorEqual(before,value)) {
      // Never mutate a general profile shared by unrelated local sources.
      const profile={...clone(value.profile),id:profileId};
      this.config.profiles=this.config.profiles.filter(p=>p.id!==profile.id);
      this.config.profiles.push(profile);
      rule.profileId=profile.id;
      rule.output=value.output;rule.recursive=value.recursive;rule.exclude=[...value.exclude];
    }
  }
  private async syncMirrorSettings(publishLocal: boolean) {
    const io=this.sharedIO();if(!io)return;
    const catalog=new MirrorCatalog(io),available=await catalog.list();
    const issues: typeof this.sharedSettingsIssues=[];
    for(const rule of this.config.rules) {
      if(publishLocal)rule.sharedId??=crypto.randomUUID();
      if(!rule.sharedId)continue;
      const name=rule.source.replace(/\\/g,"/").replace(/\/+$/,"").split("/").pop()??"Source";
      try {
        const sharedHashId=await hash(rule.sharedId);
        const recordPrefix=`${catalog.folder}/${sharedHashId}`;
        if(catalog.problems.some(problem=>problem.path.startsWith(recordPrefix)))throw Error("Shared settings contain damaged or conflicting records. Resolve their Sync conflict copies before changing settings.");
        const remote=available.find(m=>m.id===rule.sharedId);
        const local=this.portableSettings(rule), signature=JSON.stringify([rule,local]);
        if(rule.sharedRevision && remote?.revision!==rule.sharedRevision &&
            (!remote?.revision || !remote.ancestors?.includes(rule.sharedRevision))) {
          issues.push({ruleId:rule.id,name,fields:["settings history"],reason:
            remote?.revision && rule.sharedAncestors?.includes(remote.revision)
              ? "Synced settings are older than this device. Choose which version to use."
              : "Settings were changed independently or by an older plugin. Choose which version to use."});
          continue;
        }
        // Choosing an existing shared mirror explicitly binds a newly added source.
        const firstBinding=remote&&!this.boundMirrors.has(rule.sharedId)&&!rule.sharedBaseline;
        const result=firstBinding
          ? {value:remote,baseline:remote,publish:false,conflicts:[]}
          : reconcileMirror(local,rule.sharedBaseline,remote);
        if(result.conflicts.length) {
          issues.push({ruleId:rule.id,name,fields:result.conflicts,reason:"Settings changed on both devices. Choose which version to use."});
          continue;
        }
        // Background reads never publish unfinished local drafts or create catalog records.
        if(result.publish&&!publishLocal&&!rule.sharedPending)continue;
        const agreed=result.publish?await catalog.save(rule.sharedId,remote?.name??name,
          {...result.value,profile:{...result.value.profile,id:remote?.profile.id??result.value.profile.id,name:remote?.profile.name??result.value.profile.name}},
          mirrorFingerprint(remote)):remote;
        if(signature!==JSON.stringify([rule,this.portableSettings(rule)]))throw Error("Source settings changed while synchronization was running. Save again.");
        this.applyPortableSettings(rule,result.value,`shared-${sharedHashId.slice(0,40)}`);
        rule.sharedBaseline=clone(result.baseline??result.value);
        rule.sharedRevision=agreed?.revision;
        rule.sharedAncestors=agreed?.ancestors ? [...agreed.ancestors] : undefined;
        delete rule.sharedPending;
        this.boundMirrors.add(rule.sharedId);
      } catch(error) {
        if(publishLocal)rule.sharedPending=true;
        issues.push({ruleId:rule.id,name,fields:[],reason:readable(error)});
      }
    }
    this.sharedSettingsIssues=issues;
  }
  async refreshSharedSettings() {
    if(this.task||this.disposed||this.initializing)return;
    return this.settingsOperation(async () => {
      if(this.task||this.disposed)return;
      const before=JSON.stringify(this.config);
      await this.syncMirrorSettings(false);
      if(before!==JSON.stringify(this.config))await this.persistSettings();
      this.emit();
    });
  }
  async resolveSharedSettings(ruleId:string,choice:"local"|"remote") {
    if(this.task)throw Error("Wait for active recognition to finish before resolving settings.");
    return this.settingsOperation(async () => {
      const rule=this.config.rules.find(r=>r.id===ruleId),io=this.sharedIO();
      if(!rule?.sharedId||!io)throw Error("Shared source is unavailable.");
      const catalog=new MirrorCatalog(io),remote=await catalog.load(rule.sharedId);
      const profileId=`shared-${(await hash(rule.sharedId)).slice(0,40)}`;
      const signature=JSON.stringify(this.config),local=this.portableSettings(rule);
      if(choice==="remote"&&!remote)throw Error("Shared settings have not arrived. Wait for Sync and try again.");
      const value=choice==="remote"?remote!:local;
      const agreed=choice==="local"?await catalog.save(rule.sharedId,remote?.name??rule.source.split("/").pop()??"Source",
        {...value,profile:{...value.profile,id:remote?.profile.id??value.profile.id,name:remote?.profile.name??value.profile.name}},mirrorFingerprint(remote)):remote;
      if(signature!==JSON.stringify(this.config))throw Error("Settings changed while resolving. Try again.");
      this.applyPortableSettings(rule,value,profileId);
      rule.sharedBaseline=clone(value);
      rule.sharedRevision=agreed?.revision;
      rule.sharedAncestors=agreed?.ancestors ? [...agreed.ancestors] : undefined;
      delete rule.sharedPending;
      this.boundMirrors.add(rule.sharedId);
      await this.persistSettings();
      this.sharedSettingsIssues=this.sharedSettingsIssues.filter(i=>i.ruleId!==ruleId);
      this.emit();
    });
  }
  private async persist() {
    this.assertStateReady();
    const snapshot = clone(this.store);
    if(!Number.isSafeInteger(this.generation+1)){this.blockState(STATE_STORAGE_BLOCK);this.assertStateReady();}
    const generation = ++this.generation;
    const path = `${this.storageFolder}/state-${generation % 2 ? "a" : "b"}.json`;
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        this.assertStateReady();
        const encoded=await encodeStateSnapshot({ generation, store: snapshot });
        await this.app.vault.adapter.write(
          path,
          encoded,
        );
        if(!this.stateEstablished){await this.saveData({config:this.config,stateInitialized:true});this.stateEstablished=true;}
      });
    this.writes = operation;
    try { await operation; }
    catch { this.blockState("Notebook state could not be saved. Recognition is blocked; completed results are retained in memory. Restore writable storage and saved state, then reload Obsidian."); this.assertStateReady(); }
  }
  private blockState(reason:string){this.stateStorageIssue=reason;this.progress.stateBlocked=reason;this.progress.executionBlocked=reason;}
  private assertStateReady(){if(this.stateStorageIssue)throw new RecognitionFailure("provider",this.stateStorageIssue,{scope:"batch"});}
  private assertAttemptStorageReady(){
    try{this.costBook.recoverableAttempts();this.subscriptionBook.recoverableAttempts();}
    catch(error){this.progress.budgetBlocked=readable(error);throw error;}
  }
  private acknowledgeAttempts(source:string,pageId?:string,fingerprint?:string){
    this.costBook.acknowledgeRecovery(source,pageId,fingerprint);this.subscriptionBook.acknowledgeRecovery(source,pageId,fingerprint);
  }
  private async recoverInterruptedAttempts(source?:string){
    const rows=[...this.costBook.recoverableAttempts(),...this.subscriptionBook.recoverableAttempts()].filter(row=>!row.recipe?.startsWith("cleanup:")&&(!source||row.source===source));
    const shared=this.shared;let changed=false;
    if(shared)for(const row of rows){
      const state=this.store.notebooks[row.source],page=state?.desired.find(p=>p.id===row.pageId);
      if(!state||!page||page.fingerprint!==row.fingerprint||!row.recipe||!/^[a-f0-9]{64}$/.test(row.recipe)||state.forcePending?.includes(page.id)||state.pages[page.id]?.fingerprint===page.fingerprint)continue;
      const rule=ruleFor(row.source,this.config.rules);if(!rule)continue;
      const id=await notebookIdentity(rule.sharedId??rule.id,relativeToRule(row.source,rule));
      const result=(await shared.findResult({notebookId:id,pageId:page.id,fingerprint:page.fingerprint,recipe:row.recipe})).chosen;
      if(result){state.pages[page.id]={fingerprint:page.fingerprint,text:result.text,recipe:row.recipe,number:page.number,...(result.recognition?{recognition:result.recognition}:{}),...(isEmptyPage(result.text)?{blank:true}:{})};changed=true;}
    }
    const holds=interruptedAttempts(rows,this.store.notebooks);
    for(const issue of holds.pages){
      const state=this.store.notebooks[issue.source];
      (state.pageIssues??={})[issue.pageId]={fingerprint:issue.fingerprint,number:issue.number,status:"failed",kind:issue.kind,reason:issue.reason,attempts:1,updatedAt:new Date().toISOString(),...(state.forcePending?.includes(issue.pageId)?{force:true}:{})};
      if(!["conflict","missing","excluded"].includes(state.status))state.status=pendingPages(state).length?"queued":"partial";
      if(state.status==="partial")this.store.queue=this.store.queue.filter(t=>t.source!==state.source);changed=true;
    }
    for(const hold of holds.legacy){
      const state=this.store.notebooks[hold.source];if(state.legacyPageFailure)continue;
      state.legacyPageFailure=hold.reason;if(!["conflict","missing","excluded"].includes(state.status)){state.status="failed";state.error=hold.reason;}
      this.store.queue=this.store.queue.filter(t=>t.source!==state.source);changed=true;
    }
    if(changed)await this.persist();
  }
  private async migratePrototype(data: any) {
    const legacy = data.config;
    const glossaries: string[] = [];
    // Only migrate reference text the user previously supplied. Fresh setups
    // have no bundled vocabulary, language assumptions or sample notebooks.
    if (typeof legacy.glossary === "string" && legacy.glossary.trim()) {
      let path = "Supernote Transcripts/Glossaries/Imported glossary.txt";
      await this.ensureFolder(path);
      let suffix = 1;
      while (await this.app.vault.adapter.exists(path)) {
        if ((await this.app.vault.adapter.read(path)) === legacy.glossary)
          break;
        path = `Supernote Transcripts/Glossaries/Imported glossary (${++suffix}).txt`;
      }
      if (!(await this.app.vault.adapter.exists(path)))
        await this.app.vault.create(path, legacy.glossary);
      glossaries.push(path);
    }
    this.config = {
      ...freshConfig(),
      profiles: [
        { ...DEFAULT_PROFILE, glossaries: [], quality: "fast" },
        {
          id: "reflections",
          name: "Imported settings",
          model: legacy.model ?? DEFAULT_PROFILE.model,
          endpoint: legacy.endpoint ?? DEFAULT_PROFILE.endpoint,
          prompt: legacy.prompt ?? GENERAL_PROMPT,
          glossaries,
        },
      ],
      rules: [
        {
          id: "reflections",
          enabled: true,
          source: legacy.source ?? "/storage/emulated/0/Note",
          output: legacy.output ?? "Supernote Transcripts/Transcripts",
          recursive: true,
          exclude: [],
          profileId: "reflections",
        },
      ],
    };
    for (const [source, results] of Object.entries(data.cache ?? {}) as [
      string,
      Record<string, any>,
    ][]) {
      const id = await hash(source);
      const pages: NotebookState["pages"] = {};
      for (const [number, result] of Object.entries(results))
        pages[`legacy:${number}`] = {
          fingerprint: "",
          legacyRenderHash: result.hash,
          text: result.text,
          recipe: result.recipe,
          number: Number(number),
        };
      this.store.notebooks[source] = {
        id,
        source,
        ruleId: "reflections",
        output: mirrorPath(source, this.config.rules[0]),
        revision: "",
        order: Object.keys(pages),
        desired: [],
        pages,
        status: "queued",
        legacy: true,
        publishedHash: await hash(
          documentText(source.split("/").pop()!.slice(0, -5), results),
        ),
      };
    }
    await this.persist();
  }
  private async ensureFolder(path: string) {
    const parts = path.split("/");
    for (let n = 1; n < parts.length; n++) {
      const parent = parts.slice(0, n).join("/");
      if (!(await this.app.vault.adapter.exists(parent)))
        await this.app.vault.createFolder(parent);
    }
  }
  private validateConfig() {
    if (!this.config.rules.some((r) => r.enabled))
      throw new Error(
        "Enable at least one source folder or notebook in settings.",
      );
    for (const rule of this.config.rules.filter((r) => r.enabled)) {
      if(rule.autoRecognize!==undefined&&typeof rule.autoRecognize!=="boolean")throw Error("Choose Automatic or Manual updates for this source.");
      rule.source = validateSource(rule.source,this.platform);
      validateDestination(rule.output);
      if (!this.config.profiles.some((p) => p.id === rule.profileId))
        throw new Error(`Choose a profile for ${rule.source}.`);
    }
    if (
      !Number.isInteger(this.config.batchPages) ||
      this.config.batchPages < 1 ||
      this.config.batchPages > 50
    )
      throw new Error("Set pages per batch between 1 and 50.");
  }
  private async profile(id: string) {
    const found = this.config.profiles.find((p) => p.id === id);
    if (!found) throw new Error("Transcription profile was removed.");
    const profile = clone(found);
    let reference = "";
    for (const path of profile.glossaries) {
      validateDestination(path);
      if (!/\.(md|txt)$/i.test(path))
        throw new Error(
          "Glossary must be a .md or .txt file inside this vault.",
        );
      let text: string;
      try { text = await this.app.vault.adapter.read(path); }
      catch { throw new Error(`Cannot read glossary "${path}". Restore it in this vault or choose another glossary in the mirror settings.`); }
      if (text.length > 100000)
        throw new Error(`Glossary ${path} exceeds 100,000 characters.`);
      reference += `\n\nReference glossary: ${path}\n${text}`;
    }
    if (reference.length > 150000)
      throw new Error("Combined glossaries are too large.");
    const recipe = await hash(JSON.stringify([profile.model, this.provider==="subscription"?"https://api.openai.com/v1/responses":profile.endpoint,profile.prompt,reference,TRANSCRIPTION_RESPONSE_RULES,qualitySettings(profile.quality),GROUP_RESPONSE_RULES,"group-json-v1"]));
    this.recipes.set(id,recipe);
    return {
      profile,
      reference,
      recipe,
      promptHash: await hash(profile.prompt),
      glossaryHash: await hash(reference),
    };
  }
  private enqueue(source: string, force = false, pageIds?: string[]) {
    const task = this.store.queue.find((t) => t.source === source);
    if (task) { task.force ||= force; if(task.pageIds && pageIds)task.pageIds=[...new Set([...task.pageIds,...pageIds])]; }
    else this.store.queue.push({ source, force, ...(pageIds?{pageIds:[...new Set(pageIds)]}:{}) });
  }
  async update(automatic = false): Promise<void> {
    await this.subscriptionRecovery;
    this.assertStateReady();
    this.assertAttemptStorageReady();
    if (this.task) {
      await this.task;
      return;
    }
    await this.refreshSharedSettings();
    if(this.task){await this.task;return;}
    this.stop = false;
    this.automaticRun = automatic;
    this.callsThisRun = 0;
    this.progress = { ...emptyProgress(), running: true };
    for(const state of Object.values(this.store.notebooks))if(state.executionIssue?.scope==="batch")delete state.executionIssue;
    this.costBook.beginRun();
    this.setPaused(false);
    const operation = this.performUpdate();
    this.task = operation;
    try {
      await operation;
    } catch (error) {
      this.stage("Needs attention", readable(error));
      new Notice(readable(error));
      throw error;
    } finally {
      this.task = null;
      this.automaticRun = false;
      this.progress.running = false;
      await this.recoverSubscriptionConnection();
      this.emit();
    }
  }
  private setPaused(paused: boolean) {
    this.progress.paused = paused;
    localStorage.setItem(`${this.devicePrefix}:paused`, String(paused));
    this.emit();
  }
  pause() {
    this.stop = true;
    this.setPaused(true);
    this.stage(
      this.task ? "Pausing" : "Paused",
      this.task
        ? "The current page will finish and be saved before pausing."
        : "Successful pages are saved. Resume to continue.",
    );
  }
  async resume() {
    this.assertStateReady();
    this.stop = false;
    this.setPaused(false);
    await this.update();
  }
  async retry() {
    this.assertStateReady();
    if(this.task||this.progress.running)throw Error("Pause and wait for active work before retrying notebooks.");
    for (const state of Object.values(this.store.notebooks))
      if (state.status === "failed") {
        this.acknowledgeAttempts(state.source);
        delete state.legacyPageFailure; delete state.executionIssue;
        state.status = "queued";
        delete state.error;
        this.enqueue(state.source);
      }
    await this.persist();
    await this.update();
  }
  private pageActionState(source:string,pageId:string) {
    this.assertStateReady();
    if(this.task||this.progress.running)throw Error("Pause and wait for active work before changing a page action.");
    const state=this.store.notebooks[source],page=state?.desired.find(p=>p.id===pageId);
    if(!state||!page||!this.sourceSelected(source))throw Error("This page is outside the current notebook selection. Check sources first.");
    if(state.status==="conflict"||state.status==="missing")throw Error("Resolve this notebook's source or Markdown conflict before retrying pages.");
    return {state,page};
  }
  async retryPage(source:string,pageId:string) {
    const {state,page}=this.pageActionState(source,pageId),issue=state.pageIssues?.[pageId];
    if(!issue||issue.fingerprint!==page.fingerprint)throw Error("This page has no current failure or skip to retry.");
    this.acknowledgeAttempts(source,pageId,page.fingerprint);
    if(issue.force)state.forcePending=[...new Set([...(state.forcePending??[]),pageId])];
    state.pageAttempts??={};state.pageAttempts[pageId]={fingerprint:page.fingerprint,count:issue.attempts};
    delete state.pageIssues![pageId];state.status="queued";delete state.error;
    this.enqueue(source,false,[pageId]);await this.persist();this.emit();
  }
  async skipPage(source:string,pageId:string) {
    const {state,page}=this.pageActionState(source,pageId),old=state.pageIssues?.[pageId];
    if(state.pages[pageId]?.fingerprint===page.fingerprint&&!state.forcePending?.includes(pageId)&&!old?.force)throw Error("This page already has a saved transcription.");
    this.acknowledgeAttempts(source,pageId,page.fingerprint);
    state.pageIssues??={};state.pageIssues[pageId]={fingerprint:page.fingerprint,number:page.number,status:"skipped",kind:old?.kind??"unknown",reason:"Skipped by you; no successful recognition is claimed.",attempts:old?.fingerprint===page.fingerprint?old.attempts:0,updatedAt:new Date().toISOString(),...(old?.force||state.forcePending?.includes(pageId)?{force:true}:{})};
    state.forcePending=state.forcePending?.filter(id=>id!==pageId);
    state.status=pendingPages(state).length?"queued":"partial";
    this.enqueue(source);
    await this.persist();this.emit();
  }
  async retryNotebook(source:string) {
    this.assertStateReady();
    if(this.task||this.progress.running)throw Error("Pause and wait for active work before retrying this notebook.");
    const state=this.store.notebooks[source];
    if(!state||!this.sourceSelected(source))throw Error("Notebook is outside the enabled source selection.");
    if(state.status==="conflict"||state.status==="missing")throw Error("Resolve this notebook's source or Markdown conflict before retrying.");
    this.acknowledgeAttempts(source);
    delete state.legacyPageFailure;delete state.executionIssue;delete state.error;
    state.status="queued";const queued=this.store.queue.find(t=>t.source===source);if(queued)delete queued.pageIds;this.enqueue(source);await this.persist();this.emit();
  }
  async setSourcePaused(ruleId: string, paused: boolean) {
    const rule = this.config.rules.find((r) => r.id === ruleId);
    if (!rule) throw new Error("Source not found.");
    rule.paused = paused;
    await this.saveConfig();
    this.emit();
    if (!paused && !this.progress.paused && this.aiEnabled && !this.task)
      await this.update();
  }
  async setNotebookPaused(source: string, paused: boolean) {
    const state = this.store.notebooks[source];
    if (!state) throw new Error("Notebook not found.");
    state.paused = paused;
    await this.persist();
    this.emit();
    if (!paused && !this.progress.paused && this.aiEnabled && !this.task)
      await this.update();
  }
  get queueView(): QueueView {
    const active = this.progress.running
      ? (this.progress.activeSource ?? this.progress.activePage?.source)
      : undefined;
    const selected = orderedTasks(this.store.queue).filter((t) =>
      this.sourceSelected(t.source),
    );
    const page = this.progress.activePage;
    return {
      working: active
        ? {
            source: active,
            stage: this.progress.stage,
            number: page?.source === active ? page.number : undefined,
            total: page?.source === active ? page.total : undefined,
          }
        : undefined,
      waiting: selected
        .filter((t) => t.source !== active && !this.sourcePaused(t.source))
        .map((t) => t.source),
      paused: selected
        .filter((t) => t.source !== active && this.sourcePaused(t.source))
        .map((t) => t.source),
      attention: Object.values(this.store.notebooks)
        .filter(
          (s) =>
            this.sourceSelected(s.source) &&
            (["failed", "conflict"].includes(s.status)||s.desired.some(p=>s.pageIssues?.[p.id]?.fingerprint===p.fingerprint&&s.pageIssues[p.id].status==="failed")||!!s.legacyPageFailure||!!s.executionIssue),
        )
        .map((s) => s.source),
    };
  }
  async prioritizeNotebook(source: string) {
    if (!this.sourceSelected(source))
      throw new Error("This notebook is excluded from the mirror.");
    const state = this.store.notebooks[source];
    if (
      !state ||
      ["current", "failed", "conflict", "missing"].includes(state.status)
    )
      throw new Error("Choose a waiting notebook.");
    this.enqueue(source);
    const task = this.store.queue.find((t) => t.source === source)!;
    task.priority =
      Math.max(0, ...this.store.queue.map((t) => t.priority ?? 0)) + 1;
    await this.persist();
    this.emit();
    if (
      !this.task &&
      !this.progress.paused &&
      !this.progress.budgetBlocked &&
      !this.sourcePaused(source) &&
      this.aiEnabled &&
      this.active
    )
      await this.update();
  }
  async excludeNotebook(source: string) {
    const rule = ruleFor(validateSource(source), this.config.rules);
    if (!rule) throw new Error("Notebook is not in an enabled source.");
    const relative = literalExclusion(relativeToRule(source, rule)),
      previous = [...rule.exclude];
    if (!rule.exclude.includes(relative)) rule.exclude.push(relative);
    try {
      await this.saveConfig();
    } catch (error) {
      rule.exclude = previous;
      throw error;
    }
    const state = this.store.notebooks[source];
    if (state) {
      state.status = "excluded";
      delete state.error;
    }
    this.store.queue = this.store.queue.filter((t) => t.source !== source);
    await this.persist();
    this.emit();
  }
  async listNotebookChoices(
    rule: FolderRule,
    findExisting = false,
  ): Promise<NotebookChoice[]> {
    const entries = await this.reader().list(
      validateSource(rule.source),
      rule.recursive,
      [],
    );
    const markdown = new Map<string, string[]>();
    if (findExisting) {
      const files = this.app.vault.getFiles?.();
      const paths: string[] = [];
      if (files) paths.push(...files.map((f) => f.path));
      else {
        const walk = async (path: string, depth: number) => {
          if (depth > 64)
            throw new Error("Vault folders are too deeply nested.");
          const listing = await this.app.vault.adapter.list(path);
          paths.push(...listing.files);
          for (const folder of listing.folders)
            if (!folder.split("/").some((p) => p.startsWith(".")))
              await walk(folder, depth + 1);
        };
        await walk("", 0);
      }
      for (const path of paths) {
        if (
          !/\.md$/i.test(path) ||
          path.split("/").some((p) => p.startsWith(".")) ||
          /^Supernote Transcripts\/(History|Archive)\//i.test(path) || isSharedPath(path)
        )
          continue;
        const basename = path.split("/").pop()!.toLocaleLowerCase(),
          matches = markdown.get(basename) ?? [];
        matches.push(path);
        markdown.set(basename, matches);
      }
    }
    return entries
      .map((entry) => ({
        source: entry.path,
        relative: relativeToRule(entry.path, rule),
        existingTranscripts:
          markdown.get(
            entry.path
              .split("/")
              .pop()!
              .replace(/\.note$/i, ".md")
              .toLocaleLowerCase(),
          ) ?? [],
      }))
      .sort((a, b) => a.relative.localeCompare(b.relative));
  }
  private sourceSelected(source: string) {
    const rule = ruleFor(source, this.config.rules);
    if (!rule || excluded(source, rule.source, rule.exclude)) return false;
    const relative = source.slice(rule.source.length + 1);
    return (
      rule.recursive || rule.source.endsWith(".note") || !relative.includes("/")
    );
  }
  private shouldYield(source: string) {
    const task = this.store.queue.find((t) => t.source === source);
    return orderedTasks(this.store.queue).some(
      (t) =>
        t.source !== source &&
        (t.priority ?? 0) > (task?.priority ?? 0) &&
        this.sourceSelected(t.source) &&
        !this.sourcePaused(t.source),
    );
  }
  private async discover() {
    this.validateConfig();
    const rules=clone(this.config.rules),rulesSignature=JSON.stringify(this.config.rules);
    const reader = this.reader(),
      found = new Map<string, SourceEntry>(),
      destinations = new Map<string, string>();
    this.stage(
      "Checking sources",
      "Listing selected folders. No pages are sent to AI during this step.",
    );
    // Missing sources never cause deletion when any selected inventory fails.
    for (const rule of rules.filter((r) => r.enabled)) {
      const entries = await reader.list(
        rule.source,
        rule.recursive,
        rule.exclude,
      );
      for (const entry of entries) {
        const selected = ruleFor(entry.path, rules);
        if (
          !selected ||
          excluded(entry.path, selected.source, selected.exclude)
        )
          continue;
        const relative = entry.path.slice(selected.source.length + 1);
        if (
          !selected.recursive &&
          relative.includes("/") &&
          !selected.source.endsWith(".note")
        )
          continue;
        const output = this.store.notebooks[entry.path]?.outputOverride ?? mirrorPath(entry.path, selected);
        validateDestination(output);
        const collision = destinations.get(output.toLocaleLowerCase());
        if (collision && collision !== entry.path)
          throw new Error(
            `Two notebooks map to ${output}. Choose separate output folders.`,
          );
        destinations.set(output.toLocaleLowerCase(), entry.path);
        found.set(entry.path, {
          ...entry,
          relative: entry.path.split("/").pop()!,
          output,
          ruleId: selected.id,
          profileId: selected.profileId,
        });
      }
    }
    if(JSON.stringify(this.config.rules)!==rulesSignature)throw Error("Source settings changed during scanning. Update again before changing the saved notebook inventory.");
    this.scanSources = new Set(found.keys());
    this.store.queue = this.store.queue.filter((t) => found.has(t.source));
    const entries = Array.from(found.values()).sort(
      (a, b) => b.mtime - a.mtime,
    );
    this.progress.total = entries.length;
    for (const entry of entries) {
      let state = this.store.notebooks[entry.path];
      if (!state) {
        state = {
          id: await hash(entry.path),
          source: entry.path,
          ruleId: entry.ruleId,
          output: entry.output,
          revision: "",
          order: [],
          desired: [],
          pages: {},
          status: "queued",
        };
        this.store.notebooks[entry.path] = state;
      }
      if(state.executionIssue?.scope==="source"){
        const resolved=await this.profile(entry.profileId);
        if(state.executionIssue.recipe!==resolved.recipe){delete state.executionIssue;state.status="queued";}
      }
      if(state.legacyPageFailure||state.executionIssue){this.store.queue=this.store.queue.filter(t=>t.source!==entry.path);this.progress.checked++;continue;}
      if (
        state.revision !== `${entry.mtime}:${entry.size}` ||
        state.output !== entry.output ||
        state.ruleId !== entry.ruleId ||
        state.status === "missing" ||
        state.status === "excluded" ||
        state.status === "queued" ||
        (state.status === "conflict" && state.error?.startsWith("Shared transcript")) ||
        state.legacy
      ) {
        this.enqueue(entry.path);
        if (state.status === "missing" || state.status === "excluded")
          state.status = "queued";
      } else if (state.status === "current") {
        const resolved = await this.profile(entry.profileId);
        state.profileOutdated = profileNeedsRefresh(state, resolved.recipe);
      }
      const queued = this.store.queue.find((t) => t.source === entry.path);
      if (queued) queued.modified = entry.mtime;
      this.progress.checked++;
      this.emit();
    }
    for (const state of Object.values(this.store.notebooks))
      if (!found.has(state.source)) {
        const selected = ruleFor(state.source, this.config.rules),
          relative = selected
            ? state.source.slice(selected.source.length + 1)
            : "";
        if (
          !selected ||
          excluded(state.source, selected.source, selected.exclude) ||
          (!selected.recursive &&
            relative.includes("/") &&
            !selected.source.endsWith(".note"))
        ) {
          state.status = "excluded";
          state.error =
            "Outside the enabled source selection. Existing Markdown is retained.";
          continue;
        }
        state.status = "missing";
        state.error =
          "Not found in the completed scan. Previous transcript is kept in the archive.";
        try {
          if (!state.output.startsWith("Supernote Transcripts/Archive/"))
            await this.relocateOutput(
              state,
              `Supernote Transcripts/Archive/${state.id.slice(0, 12)}/${state.output.split("/").pop()}`,
            );
        } catch (error) {
          state.status = "conflict";
          state.error = readable(error);
        }
        this.store.queue = this.store.queue.filter(
          (t) => t.source !== state.source,
        );
      }
    this.store.lastChecked = new Date().toISOString();
    await this.persist();
    return found;
  }
  private async performUpdate() {
    const entries = await this.discover();
    let remaining =
      this.config.continuous === false ? this.config.batchPages : Infinity;
    const visited = new Set<string>();
    while (true) {
      if (
        this.stop ||
        this.disposed ||
        !this.active ||
        this.progress.budgetBlocked ||
        this.progress.executionBlocked ||
        remaining <= 0
      )
        break;
      const task = orderedTasks(this.store.queue).find(
        (t) =>
          entries.has(t.source) &&
          !visited.has(t.source) &&
          this.sourceSelected(t.source) &&
          !this.sourcePaused(t.source),
      );
      if (!task) break;
      const entry = entries.get(task.source);
      if (!entry) continue;
      if (this.sourcePaused(task.source)) continue;
      const startedCalls = this.callsThisRun;
      this.progress.activeSource = task.source;
      this.emit();
      try {
        await this.processNotebook(entry, task.force, remaining, undefined, task.pageIds);
        if (task.pageIds || ["current","partial"].includes(this.store.notebooks[task.source]?.status))
          this.store.queue = this.store.queue.filter(
            (t) => t.source !== task.source,
          );
        if (!this.shouldYield(task.source) && !this.sourcePaused(task.source))
          visited.add(task.source);
      } catch (error) {
        const state = this.store.notebooks[task.source];
        if (error instanceof BudgetBlocked) {
          if (state) {
            state.status = "queued";
            delete state.error;
          }
          this.progress.budgetBlocked = readable(error);
          this.stage("Spending paused", readable(error));
          await this.persist();
          break;
        }
        if (state) {
          state.status = /manually edited|Shared transcript|publication receipt|ownership record/i.test(readable(error))
            ? "conflict"
            : "failed";
          state.error = readable(error);
          if(isRecognitionFailure(error)&&error.fatal){
            state.executionIssue??={scope:error.scope==="batch"?"batch":"source",reason:readable(error),recipe:this.recipes.get(entry.profileId),...(error.code?{code:error.code}:{})};
            if(error.scope==="batch")this.progress.executionBlocked=readable(error);
          }
          if(error instanceof Error&&error.name==="SourceChangedError")state.executionIssue??={scope:"source",reason:readable(error),recipe:this.recipes.get(entry.profileId)};
        }
        this.store.queue = this.store.queue.filter(
          (t) => t.source !== task.source,
        );
        this.stage(
          "Notebook needs attention",
          `${entry.relative}: ${readable(error)}`,
        );
      } finally {
        delete this.progress.activeSource;
        this.emit();
      }
      remaining -= this.callsThisRun - startedCalls;
      await this.persist();
    }
    if (this.progress.budgetBlocked) {
      this.stage("Spending paused", this.progress.budgetBlocked);
    } else if (this.progress.executionBlocked) {
      this.stage("Recognition paused",this.progress.executionBlocked);
    } else if (this.stop) {
      this.setPaused(true);
      this.stage("Paused", "Successful pages are saved. Resume to continue.");
    } else if (!this.active)
      this.stage(
        "Waiting for Obsidian",
        "Successful pages are saved. Automatic work can continue when Obsidian returns.",
      );
    else {
      const failed = Object.values(this.store.notebooks).filter(
        (n) => ["failed","conflict"].includes(n.status)||n.desired.some(p=>n.pageIssues?.[p.id]?.fingerprint===p.fingerprint&&n.pageIssues[p.id].status==="failed"),
      ).length;
      this.stage(
        this.store.queue.length
          ? "Batch saved"
          : failed
            ? "Needs attention"
            : "Current",
        `${this.store.queue.length} notebook(s) queued; ${failed} need attention. Markdown is saved locally; Obsidian Sync handles delivery.`,
      );
    }
  }
  private async processNotebook(
    entry: SourceEntry,
    force: boolean,
    budget: number,
    selection?: number[] | string,
    selectedIds?: string[],
  ) {
    const reader = this.reader();
    this.stage("Checking pages", entry.relative);
    const opened = await reader.open(entry.path);
    let recognized = 0;
    const recognizedIds = new Set<string>();
    let lease: LeaseHandle | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let leaseLost = false;
    const shared=this.shared;
    const rule=this.config.rules.find(r=>r.id===entry.ruleId)!;
    const sharedId=await notebookIdentity(rule.sharedId??rule.id,relativeToRule(entry.path,rule));
    try {
      const descriptor = opened.descriptor,
        resolved = await this.profile(entry.profileId);
      if(force&&selectedIds?.some(id=>!descriptor.pages.some(p=>p.id===id)))throw Error("A selected page was removed or its identity changed. Update this notebook and choose the pages again.");
      let state = this.store.notebooks[entry.path];
      if (!state || (!state.order.length && !Object.keys(state.pages).length)) {
        const renamed = recognizeRename(
          descriptor.pages,
          Object.values(this.store.notebooks).filter(
            (n) => n.status === "missing" && !this.scanSources.has(n.source),
          ),
        );
        if (renamed) {
          delete this.store.notebooks[renamed.source];
          state = renamed;
          state.source = entry.path;
        } else
          state = state ?? {
            id: await hash(entry.path),
            source: entry.path,
            ruleId: entry.ruleId,
            output: entry.output,
            revision: "",
            order: [],
            desired: [],
            pages: {},
            status: "checking",
          };
        this.store.notebooks[entry.path] = state;
      }
      const destination = state.outputOverride ?? entry.output;
      validateDestination(destination);
      if (state.output !== destination)
        await this.relocateOutput(state, destination, true);
      const before = clone(state);
      if (state.publishedHash && !state.publishedPages?.length &&
          (await hash(buildMarkdown(before, this.showPageHeadings)) === state.publishedHash ||
           await hash(buildMarkdown(before, !this.showPageHeadings)) === state.publishedHash))
        state.publishedPages = clone(before.desired);
      state.status = "checking";
      delete state.error;
      if (state.legacy) {
        const migrated: NotebookState["pages"] = {};
        for (const page of descriptor.pages) {
          const old = state.pages[`legacy:${page.number}`];
          if (old) {
            const image = await opened.render(page.number);
            if ((await hash(image)) === old.legacyRenderHash)
              migrated[page.id] = {
                ...old,
                fingerprint: page.fingerprint,
                number: page.number,
                recipe: typeof old.recipe==="string"&&old.recipe.trim()?old.recipe:"legacy-unverified",
                legacyRenderHash: undefined,
              };
          }
        }
        state.pages = migrated;
        state.legacy = false;
      }
      const reconciled = reconcilePages(state.pages, descriptor.pages);
      state.pages = reconciled.pages as NotebookState["pages"];
      state.order = reconciled.order;
      const known = new Set(before.desired.map((page) => page.id));
      const additions = known.size
        ? descriptor.pages
            .filter((page) => !known.has(page.id))
            .map((page) => page.id)
        : [];
      state.priorityPages = [
        ...new Set([...(state.priorityPages ?? []), ...additions]),
      ].filter((id) => state.order.includes(id));
      state.desired = descriptor.pages;
      state.deviceOcr = Object.fromEntries(Object.entries(state.deviceOcr ?? {}).filter(([id,p]) => descriptor.pages.some(d => d.id===id && d.fingerprint===p.fingerprint)));
      state.cleanedPages = Object.fromEntries(Object.entries(state.cleanedPages ?? {}).filter(([id,p]) => descriptor.pages.some(d => d.id===id && d.fingerprint===p.fingerprint)));
      if (opened.readOcr) for (const page of descriptor.pages) {
        if (before.revision === descriptor.revision && state.deviceOcr[page.id]) continue;
        const text = await opened.readOcr(page.number);
        if (text?.trim()) state.deviceOcr[page.id] = { fingerprint: page.fingerprint, text };
        else delete state.deviceOcr[page.id];
      }
      const selected = typeof selection === "string" ? pagesFromRange(selection, descriptor.pages.length) : selection;
      for(const [id,issue] of Object.entries(state.pageIssues??{})){
        const page=descriptor.pages.find(p=>p.id===id);
        if(!page||page.fingerprint!==issue.fingerprint)delete state.pageIssues![id];else issue.number=page.number;
      }
      state.ruleId = entry.ruleId;
      state.output = destination;
      state.revision = descriptor.revision;
      state.profileOutdated = profileNeedsRefresh(state, resolved.recipe);
      // Explicit enhancement reviews prior attempts before interruption holds
      // are reconciled against the newly read physical page inventory.
      if(force)for(const page of descriptor.pages.filter(p=>(!selected||selected.includes(p.number))&&(!selectedIds||selectedIds.includes(p.id)))) {
        this.acknowledgeAttempts(entry.path,page.id,page.fingerprint);
        if(Array.isArray(selection)||selectedIds)delete state.pageIssues?.[page.id];
      }
      if(shared&&!force&&!state.forcePending?.length){
        const io=this.sharedIO();
        if(io&&await io.exists(state.output)){
          const text=await io.read(state.output);
          if(isManagedTranscript(text)){
            const receipt=await new PublicationReceipts(io).find(sharedId,text);
            const imported=await hydratePublicationCache({receipt,notebookId:sharedId,
              current:state.desired,before:before.desired,local:state.pages,cache:shared});
            Object.assign(state.pages,imported);
            for(const id of Object.keys(imported))delete state.pageIssues?.[id];
          }
        }
        for(const page of descriptor.pages){
          if(state.pages[page.id]?.fingerprint===page.fingerprint)continue;
          const result=(await shared.findResult({notebookId:sharedId,pageId:page.id,fingerprint:page.fingerprint,recipe:resolved.recipe})).chosen;
          if(result){state.pages[page.id]={fingerprint:page.fingerprint,text:result.text,recipe:resolved.recipe,number:page.number,...(result.recognition?{recognition:result.recognition}:{}),...(isEmptyPage(result.text)?{blank:true}:{})};delete state.pageIssues?.[page.id];}
        }
        state.profileOutdated=profileNeedsRefresh(state,resolved.recipe);
      }
      if(shared){
        for(const page of descriptor.pages){
          const local=state.pages[page.id];
          if(local?.fingerprint!==page.fingerprint||!/^[a-f0-9]{64}$/.test(local.recipe))continue;
          const query={notebookId:sharedId,pageId:page.id,fingerprint:page.fingerprint,recipe:local.recipe};
          if(!(await shared.findResult(query)).chosen)await shared.saveResult(query,local.text,local.recognition);
        }
      }
      await this.recoverInterruptedAttempts(entry.path);
      await this.checkOutput(state,before,sharedId);
      await this.persist();
      if (force && (selection || selectedIds)) {
        state.forcePending = Array.from(
          new Set([
            ...(state.forcePending ?? []),
            ...descriptor.pages
              .filter((p) => (!selected || selected.includes(p.number)) && (!selectedIds || selectedIds.includes(p.id)))
              .map((p) => p.id),
          ]),
        );
        state.historyRevision = undefined;
      } else if (force && !state.forcePending?.length) {
        state.forcePending = descriptor.pages.map((p) => p.id);
        state.historyRevision = undefined;
      }
      if (force) {
        const queued = this.store.queue.find((t) => t.source === entry.path);
        if (queued) queued.force = false;
      }
      state.forcePending = (state.forcePending ?? []).filter((id) =>
        state.order.includes(id),
      );
      await this.persist();
      const pending = descriptor.pages.filter(
        (p) =>
          (state.forcePending?.includes(p.id) ||
            state.pages[p.id]?.fingerprint !== p.fingerprint) &&
          (!selected || selected.includes(p.number)) && (!selectedIds || selectedIds.includes(p.id)) && state.pageIssues?.[p.id]?.fingerprint!==p.fingerprint,
      );
      const priority = (page: { id: string; fingerprint: string }) =>
        state.pages[page.id] &&
        state.pages[page.id].fingerprint !== page.fingerprint
          ? 0
          : state.priorityPages?.includes(page.id)
            ? 1
            : 2;
      pending.sort((a, b) => priority(a) - priority(b) || a.number - b.number);
      let workerFailed=false;
      const mayStart=()=>!workerFailed&&!this.stop&&!this.disposed&&this.active&&this.aiEnabled&&!leaseLost&&!this.sourcePaused(entry.path)&&!(!selection&&this.shouldYield(entry.path))&&!this.progress.budgetBlocked&&!this.progress.executionBlocked;
      if(pending.length&&mayStart()&&shared){
        this.stage("Checking other devices",entry.relative);
        lease=await shared.acquire(sharedId);
        if(!lease){state.status="queued";state.error="Another device is updating this notebook.";await this.persist();return 0;}
        heartbeat=setInterval(()=>{void shared.heartbeat(lease!).then(ok=>{if(!ok)leaseLost=true;}).catch(()=>{leaseLost=true;});},30000);
      }
      let renders:Promise<void>=Promise.resolve(),commits:Promise<void>=Promise.resolve();
      const commit=(operation:()=>Promise<void>)=>{const p=commits.then(operation,operation).catch(error=>{workerFailed=true;if(error instanceof BudgetBlocked)this.progress.budgetBlocked=readable(error);if(isRecognitionFailure(error)&&error.scope==="batch")this.progress.executionBlocked=readable(error);throw error;});commits=p.catch(()=>{});return p;};
      const activePages=new Set<number>();
      const query=(page:{id:string;fingerprint:string})=>({notebookId:sharedId,pageId:page.id,fingerprint:page.fingerprint,recipe:resolved.recipe});
      const groups=planRecognitionGroups(pending,descriptor.pages,resolved.profile.quality).slice(0,Number.isFinite(budget)?Math.max(0,budget):undefined);
      await runWorkers(groups,this.concurrency,async(planned:{id:string;number:number;fingerprint:string}[])=>{
        if(!mayStart())return;
        let targets=planned.slice();
        const refreshTargets=async()=>{
          const remaining=[];
          for(const page of targets){
            if(!state.forcePending?.includes(page.id)){
              const local=state.pages[page.id];
              const received=local?.fingerprint===page.fingerprint?local:shared?(await shared.findResult(query(page))).chosen:undefined;
              if(received){await commit(async()=>{state.pages[page.id]={fingerprint:page.fingerprint,text:received.text,recipe:resolved.recipe,number:page.number,...(received.recognition?{recognition:received.recognition}:{}),...(isEmptyPage(received.text)?{blank:true}:{})};delete state.pageIssues?.[page.id];await this.persist();});continue;}
            }
            remaining.push(page);
          }
          targets=remaining;
        };
        await refreshTargets();if(!targets.length)return;
        if(shared&&lease&&!await shared.checkLease(lease)){leaseLost=true;return;}
        for(const page of targets)activePages.add(page.number);
        this.progress.activePages=[...activePages].sort((a,b)=>a-b);
        this.progress.activePage={source:entry.path,number:targets[0].number,total:descriptor.pages.length};
        let phase:"render"|"guard"|"recognize"|"save"="render",guardFailed=false;
        const markFailure=async(page:{id:string;number:number;fingerprint:string},reason:string,kind:string)=>{
          const previous=state.pageIssues?.[page.id],attempt=state.pageAttempts?.[page.id];
          const attempts=(previous?.fingerprint===page.fingerprint?previous.attempts:attempt?.fingerprint===page.fingerprint?attempt.count:0)+1;
          (state.pageIssues??={})[page.id]={fingerprint:page.fingerprint,number:page.number,status:"failed",kind,reason,attempts,updatedAt:new Date().toISOString(),...(state.forcePending?.includes(page.id)?{force:true}:{})};
          state.forcePending=state.forcePending?.filter(id=>id!==page.id);
        };
        try{
          let context=contextPages(targets,descriptor.pages,resolved.profile.quality);
          const images:{label:string;image:string}[]=[];
          for(const page of [...targets,...context]){
            this.stage("Rendering",`${entry.relative} — page ${page.number}`);
            const render=renders.then(()=>opened.render(page.number));renders=render.then(()=>{},()=>{});
            try{images.push({label:`${targets.some(t=>t.id===page.id)?"TARGET":"CONTEXT"} PAGE ${page.number}`,image:await render});}
            catch(error){if((error instanceof Error&&error.name==="SourceChangedError")||await reader.revision(entry.path)!==descriptor.revision)throw error;if(!targets.some(t=>t.id===page.id)){context=context.filter(p=>p.id!==page.id);continue;}await commit(async()=>{await markFailure(page,readable(error),"render");await this.persist();});targets=targets.filter(t=>t.id!==page.id);}
          }
          if(!targets.length)return;
          phase="guard";
          if(!mayStart())return;
          if((await reader.revision(entry.path))!==descriptor.revision)throw Error("Notebook changed before recognition. Retry after saving it.");
          const textContext=[...context.map(p=>{const t=pageTextLayer(state,p);return !t.stale&&t.text?`CONTEXT PAGE ${p.number}: ${t.text}`:"";}),
            ...targets.map(p=>state.pages[p.id]?.text?`PREVIOUS VERSION OF TARGET PAGE ${p.number} (may be outdated; the new image is authoritative): ${state.pages[p.id].text}`:""),
            ...[...targets,...context].map(p=>state.deviceOcr?.[p.id]?.text?`UNVERIFIED DEVICE OCR PAGE ${p.number} (image is authoritative): ${state.deviceOcr[p.id].text}`:"")]
            .filter(Boolean).join("\n").slice(0,qualitySettings(resolved.profile.quality).textContextChars);
          // Snapshot group identities and context; late cache arrivals cancel and replan unsent targets in this update.
          const requestTargets=targets.slice();
          const prompt=recognitionPrompt(resolved.profile.prompt,resolved.reference,targets,context,textContext,resolved.profile.quality);
          state.status="recognizing";phase="recognize";
          const request = { targets:requestTargets, images, prompt, usedModel:resolved.profile.model };
          const raw=await this.transcribe(images[0].image,targets[0].number,resolved.profile,resolved.reference,entry.path,resolved.recipe,async()=>{
            try{
              if(!mayStart())return false;
              if((await reader.revision(entry.path))!==descriptor.revision)throw Error("Notebook changed before request dispatch. Previous results are saved.");
              if(shared&&lease&&!await shared.checkLease(lease)){leaseLost=true;return false;}
              await refreshTargets();return targets.length===requestTargets.length;
            }catch(error){guardFailed=true;throw error;}
          },targets[0].fingerprint,request);
          phase="save";if(raw===null){if(targets.length&&targets.length!==requestTargets.length&&mayStart())groups.push(...planRecognitionGroups(targets,descriptor.pages,resolved.profile.quality));return;}
          const parsed=parseRecognitionGroup(raw,requestTargets,{availablePages:images.map(item=>Number(item.label.match(/PAGE (\d+)$/)?.[1]))});
          await commit(async()=>{
            for(const result of parsed.results){
              const page=result.page;
              const text=normalizePageText(result.text);
              state.pages[page.id]={fingerprint:page.fingerprint,text,recipe:resolved.recipe,number:page.number,recognition:{provider:this.provider,model:request.usedModel,quality:qualitySettings(resolved.profile.quality).mode as "fast"|"balanced"|"careful",recognizedAt:new Date().toISOString(),promptHash:resolved.promptHash,glossaryHash:resolved.glossaryHash},...(isEmptyPage(text)?{blank:true}:{})};
              delete state.cleanedPages?.[page.id];
              if(state.cleanup)state.cleanup.stale=true;
              delete state.pageIssues?.[page.id];delete state.pageAttempts?.[page.id];
              state.forcePending=state.forcePending?.filter(id=>id!==page.id);state.priorityPages=state.priorityPages?.filter(id=>id!==page.id);
              recognized++;recognizedIds.add(page.id);this.progress.recognized++;
            }
            for(const failure of parsed.failures){const page=failure.page;if(page)await markFailure(page,failure.reason,failure.kind??"incomplete");}
            try{await this.persist();}catch(error){if(shared)for(const result of parsed.results){const page=result.page;try{await shared.saveResult(query(page),state.pages[page.id].text,state.pages[page.id].recognition);}catch{}}throw error;}
            if(shared)for(const result of parsed.results){const page=result.page;await shared.saveResult(query(page),state.pages[page.id].text,state.pages[page.id].recognition);}
            if((await reader.revision(entry.path))!==descriptor.revision)throw Error("Notebook changed during recognition. Saved results will be reconciled on retry.");
            if(!leaseLost)await this.publish(state,before,sharedId);
          });
        }catch(error){
          if(!guardFailed&&!(error instanceof Error&&error.name==="SourceChangedError")&&(phase==="render"||phase==="recognize")&&!(error instanceof BudgetBlocked)&&(!isRecognitionFailure(error)||!error.fatal)&&await reader.revision(entry.path)===descriptor.revision){
            await commit(async()=>{for(const page of targets)await markFailure(page,readable(error),isRecognitionFailure(error)?error.kind:phase==="render"?"render":"provider");await this.persist();});return;
          }
          workerFailed=true;if(error instanceof BudgetBlocked)this.progress.budgetBlocked=readable(error);if(isRecognitionFailure(error)&&error.fatal){state.executionIssue={scope:error.scope==="batch"?"batch":"source",reason:readable(error),recipe:resolved.recipe,...(error.code?{code:error.code}:{})};if(error.scope==="batch")this.progress.executionBlocked=readable(error);}if(error instanceof Error&&error.name==="SourceChangedError")state.executionIssue={scope:"source",reason:readable(error),recipe:resolved.recipe};throw error;
        }finally{for(const page of planned)activePages.delete(page.number);this.progress.activePages=[...activePages].sort((a,b)=>a-b);this.emit();}
      },mayStart);
      this.progress.reused += descriptor.pages.filter(
        (p) =>
          !recognizedIds.has(p.id) &&
          state.pages[p.id]?.fingerprint === p.fingerprint,
      ).length;
      if ((await reader.revision(entry.path)) !== descriptor.revision)
        throw new Error(
          "Notebook changed during processing. Retry after closing it in Notes.",
        );
      state.status = !this.sourceSelected(entry.path)
        ? "excluded"
        : pendingPages(state).length
          ? "queued"
          : state.desired.some(p=>state.pageIssues?.[p.id]?.fingerprint===p.fingerprint)?"partial":"current";
      state.profileOutdated = profileNeedsRefresh(state, resolved.recipe);
      if (leaseLost){state.status="queued";state.error="Another device took priority; completed pages are saved.";}
      if (!leaseLost&&(this.aiEnabled || recognized > 0 || Object.keys(state.pages).length>0 || Object.keys(state.deviceOcr??{}).length>0)) await this.publish(state, before,sharedId);
      await this.persist();
      return recognized;
    } finally {
      if(heartbeat)clearInterval(heartbeat);
      if(shared&&lease)await shared.release(lease);
      delete this.progress.activePage;
      delete this.progress.activePages;
      opened.close();
    }
  }
  private async transcriptRecovery<T>(run: () => Promise<T>): Promise<T> {
    this.assertStateReady();
    if (this.task || this.progress.running || this.disposed)
      throw Error("Pause and wait for active work before recovering a transcript.");
    const operation = run();
    this.task = operation;
    try { return await operation; }
    finally { this.task = null; this.emit(); }
  }
  private recoverySignature(state: NotebookState) {
    return JSON.stringify([state, this.showPageHeadings, this.config.rules]);
  }
  private ownedLegacyAppend(state: NotebookState, receipt: Receipt, actualHash: string) {
    const tips = receipt.candidates ?? [receipt];
    return !state.publishedPages?.length && actualHash === state.publishedHash && tips.length > 0 &&
      tips.every(r => r.pages.length > 0 && r.pages.length === tips[0].pages.length && r.pages.length <= state.desired.length &&
        r.pages.every((p, i) => p.id === state.desired[i].id && p.fingerprint === state.desired[i].fingerprint));
  }
  private async recoveryReceipts(state: NotebookState, current: string, generated: string, id: string) {
    const io = this.sharedIO();
    if (!io) return;
    const receipts = new PublicationReceipts(io);
    const hashes = new Set([await hash(current), await hash(generated)]);
    if (state.publishedHash) hashes.add(state.publishedHash);
    for (const h of hashes) {
      const receipt = await receipts.findHash(id, h);
      if (!receipt) continue;
      const knownInventory = canAdvancePublication(receipt, state.desired, state.publishedPages ?? []);
      // Older stores omitted publishedPages. Only a receipt for our owned
      // pre-edit hash may prove an unchanged prefix followed by new pages.
      // Every concurrent tip must agree; unknown edits/reorder/deletion cannot
      // be invented as a prior locally observed snapshot.
      const legacyAppend = this.ownedLegacyAppend(state, receipt, h);
      if (!knownInventory && !legacyAppend)
        throw Error("Shared transcript has a newer or conflicting page inventory. Recovery cannot validate the older snapshot; synchronize the notebook and check sources before retrying.");
      if (!await canAdoptPublication(receipt, state.desired, state.pages))
        throw Error("Shared transcript results have not arrived or conflict with local results. Recovery cannot bypass synchronization.");
    }
  }
  private async recoverySnapshot(source: string) {
    const originalState = this.store.notebooks[source];
    if (!originalState || originalState.status !== "conflict" ||
        !/manually edited|ownership record/i.test(originalState.error ?? "") ||
        /Shared transcript|publication receipt|Shared publication/i.test(originalState.error ?? ""))
      throw Error("Only manually edited or unowned generated transcripts can use this recovery action.");
    const signature = this.recoverySignature(originalState), state = clone(originalState);
    const rule = ruleFor(source, this.config.rules);
    if (!rule || !this.sourceSelected(source)) throw Error("Restore the enabled notebook selection before recovering its transcript.");
    validateDestination(state.output);
    if (!/\.md$/i.test(state.output) || isSharedPath(state.output)) throw Error("Invalid transcript recovery destination.");
    if (state.legacy) throw Error("No verified cached page text is available for this notebook.");
    const output = state.output;
    const reader = this.reader();
    const entries = await reader.list(rule.source, rule.recursive, rule.exclude);
    if (!entries.some(e => e.path === source)) throw Error("Notebook was not found in the current source scan.");
    const opened = await reader.open(source);
    try {
      const descriptor = opened.descriptor;
      if (descriptor.path !== source || typeof descriptor.revision !== "string" ||
          await reader.revision(source) !== descriptor.revision)
        throw Error("Notebook changed while reading its recovery snapshot. Save it and review again.");
      // Reconcile a private working copy only. Source edits may have accumulated
      // while output publishing was blocked by the user's Markdown corrections.
      if (state.publishedHash && !state.publishedPages?.length &&
          (await hash(buildMarkdown(originalState, this.showPageHeadings)) === state.publishedHash ||
           await hash(buildMarkdown(originalState, !this.showPageHeadings)) === state.publishedHash))
        state.publishedPages = clone(originalState.desired);
      const reconciled = reconcilePages(state.pages, descriptor.pages);
      state.pages = reconciled.pages as NotebookState["pages"];
      state.order = reconciled.order;
      state.desired = clone(descriptor.pages);
      state.revision = descriptor.revision;
      const known = new Set(originalState.desired.map(p => p.id));
      state.priorityPages = [...new Set([...(state.priorityPages ?? []),
        ...state.desired.filter(p => !known.has(p.id)).map(p => p.id)])].filter(id => state.order.includes(id));
      state.forcePending = state.forcePending?.filter(id => state.order.includes(id));
    } finally { opened.close(); }
    if (!state.desired.length || !state.desired.some(p => state.pages[p.id]?.text?.trim()))
      throw Error("No verified cached page text is available for the current notebook.");
    if (state.desired.some(p => {
      const r = state.pages[p.id];
      return r && (typeof r.text !== "string" || !r.text.trim() || typeof r.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(r.recipe));
    })) throw Error("Cached page provenance is incomplete. Recovery stopped.");
    const current = await this.app.vault.adapter.read(output);
    const title = output.split("/").pop()!.replace(/\.md$/i, "");
    if (!current.startsWith("---\nnomad_transcripts: true\n") ||
        (!/^[a-f0-9]{64}$/.test(state.publishedHash ?? "") && !current.includes(`\n# ${title}\n`)))
      throw Error("Destination is a personal note or a different notebook. Recovery refused.");
    const id = await notebookIdentity(rule.sharedId ?? rule.id, relativeToRule(source, rule));
    const endOfFrontmatter = current.indexOf("\n---", 4);
    if (endOfFrontmatter < 0) throw Error("Transcript ownership frontmatter is incomplete. Recovery refused.");
    const frontmatter = current.slice(0, endOfFrontmatter);
    for (const [key, wanted] of [["supernote_notebook_id", id], ["supernote_mirror_id", rule.sharedId ?? rule.id]]) {
      const claimed = new RegExp(`^${key}:\\s*[\"']?([^\"'\\n]+)[\"']?\\s*$`, "m").exec(frontmatter)?.[1].trim();
      if (claimed && claimed !== wanted) throw Error("Destination belongs to a different notebook. Recovery refused.");
    }
    const known = new Set([...state.desired, ...(state.publishedPages ?? [])].map(p => p.id));
    for (const marker of current.matchAll(/<!-- supernote-page:([^ ]+) number:\d+ -->/g)) {
      let pageId: string;
      try { pageId = decodeURIComponent(marker[1]); } catch { throw Error("Invalid transcript page ownership marker."); }
      if (!known.has(pageId)) throw Error("Transcript contains pages missing from this local .note source. Refresh that source before recovering.");
    }
    const generated = buildMarkdown(state, this.showPageHeadings);
    if (current === generated || await hash(current) === state.publishedHash)
      throw Error("Transcript no longer has manual changes. Check sources instead.");
    await this.recoveryReceipts(state, current, generated, id);
    if (this.store.notebooks[source] !== originalState || signature !== this.recoverySignature(originalState) ||
        await reader.revision(source) !== state.revision)
      throw Error("Notebook or transcript settings changed during recovery preview.");
    // Bind the preview to page identities/content as well as filesystem stat:
    // rapid same-size rewrites can share an observable timestamp tick.
    const revision = `${state.revision}:${await hash(JSON.stringify(state.desired))}`;
    return { state, originalState, signature, current, generated, output, reader, id, revision };
  }
  async previewTranscriptRecovery(source: string) {
    return this.transcriptRecovery(async () => {
      const { current, generated, output, revision } = await this.recoverySnapshot(source);
      return { current, generated, output, revision };
    });
  }
  async resolveTranscriptConflict(source: string, action: "replace" | "keep", expectedCurrent: string, expectedRevision?: string) {
    return this.transcriptRecovery(async () => {
      if (!["replace", "keep"].includes(action) || typeof expectedCurrent !== "string" ||
          (expectedRevision !== undefined && typeof expectedRevision !== "string")) throw Error("Invalid transcript recovery action.");
      const c = await this.recoverySnapshot(source);
      if (c.current !== expectedCurrent) throw Error("Generated transcript was manually edited since the preview. Review it again.");
      if (expectedRevision !== undefined && c.revision !== expectedRevision)
        throw Error("Notebook changed since the recovery preview. Review its current pages again.");
      const shared = this.shared;
      let lease: LeaseHandle | null = null, backup: string | undefined, replacementWritten = false;
      const previousTasks = clone(this.store.queue.filter(t => t.source === source));
      const assertCurrent = async (expected = c.current) => {
        if (this.store.notebooks[source] !== c.originalState || this.recoverySignature(c.originalState) !== c.signature ||
            await c.reader.revision(source) !== c.state.revision)
          throw Error("Notebook or transcript settings changed before recovery could save.");
        if (await this.app.vault.adapter.read(c.output) !== expected)
          throw Error("Generated transcript was manually edited while recovering. Review it again.");
        await this.recoveryReceipts(c.state, c.current, c.generated, c.id);
        if (shared && lease && !await shared.checkLease(lease)) throw Error("Another device is updating this notebook. Recovery stopped.");
      };
      try {
        if (shared) {
          lease = await shared.acquire(c.id);
          if (!lease) throw Error("Another device is updating this notebook. Try recovery after it finishes.");
        }
        await assertCurrent();
        const next = clone(c.state);
        if (action === "replace") {
          const title = source.split("/").pop()!.replace(/\.note$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/, "").slice(0, 100) || "Notebook";
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          backup = `Supernote Transcripts/History/${title}/${stamp}-${crypto.randomUUID()}.md`;
          await this.ensureFolder(backup);
          await this.app.vault.create(backup, c.current);
          this.store.history.push(backup);
          await this.persist();
          await assertCurrent();
          await this.app.vault.adapter.process(c.output, current => {
            if (current !== expectedCurrent) throw Error("Generated transcript was manually edited while saving recovery.");
            return c.generated;
          });
          replacementWritten = true;
          await assertCurrent(c.generated);
        } else {
          const stem = c.output.replace(/\.md$/i, "");
          let n = 1, output = `${stem} (mirror).md`;
          while (await this.app.vault.adapter.exists(output) || Object.values(this.store.notebooks).some(s =>
            s.source !== source && (s.outputOverride ?? s.output).toLocaleLowerCase() === output.toLocaleLowerCase()))
            output = `${stem} (mirror ${++n}).md`;
          next.output = output; next.outputOverride = output;
          await this.ensureFolder(output); await assertCurrent();
          // create refuses an unexpected file appearing after the availability check.
          await this.app.vault.create(output, buildMarkdown(next, this.showPageHeadings));
          await assertCurrent();
        }
        const generated = buildMarkdown(next, this.showPageHeadings);
        if (await this.app.vault.adapter.read(next.output) !== generated)
          throw Error("Generated transcript was manually edited before recovery completed.");
        const io = this.sharedIO();
        if (io) await new PublicationReceipts(io).save(c.id, generated, next.desired, next.pages,this.presentationFor(next));
        await assertCurrent(action === "replace" ? generated : c.current);
        if (await this.app.vault.adapter.read(next.output) !== generated)
          throw Error("Generated transcript was manually edited before recovery completed.");
        next.publishedHash = await hash(generated); next.publishedPages = clone(next.desired);
        next.lastSaved = new Date().toISOString();
        const pending = pendingPages(next).length>0;
        next.status = pending ? "queued" : next.desired.some(p=>next.pageIssues?.[p.id]?.fingerprint===p.fingerprint)?"partial":"current"; delete next.error;
        this.store.notebooks[source] = next;
        this.store.queue = this.store.queue.filter(t => t.source !== source);
        if (pending) this.enqueue(source);
        await this.persist();
        this.stage("Transcript recovered", `${next.output} saved locally. Pending pages wait for your next Update or Resume.`);
        return { backup, output: next.output };
      } catch (error) {
        if (this.store.notebooks[source] !== c.originalState) {
          this.store.notebooks[source] = c.originalState;
          this.store.queue = [...this.store.queue.filter(t => t.source !== source), ...previousTasks];
        }
        // Restore only our exact replacement; never erase an intervening edit.
        if (replacementWritten) await this.app.vault.adapter.process(c.output, current => current === c.generated ? c.current : current);
        throw error;
      } finally { if (shared && lease) await shared.release(lease); }
    });
  }
  private presentationFor(state: NotebookState) {
    return state.cleanup ? { cleanedPages:state.cleanedPages??{}, cleanup:state.cleanup } : undefined;
  }
  private async publish(state: NotebookState, before: NotebookState, sharedId?:string) {
    await this.checkOutput(state,before,sharedId);
    this.stage(
      "Saving Markdown",
      `${state.output}. This is a local save; Obsidian Sync delivers it separately.`,
    );
    const text = buildMarkdown(state,this.showPageHeadings),
      path = state.output;
    await this.ensureFolder(path);
    const exists = await this.app.vault.adapter.exists(path);
    let previous = "";
    if (exists) {
      previous = await this.app.vault.adapter.read(path);
      if (!previous.startsWith("---\nnomad_transcripts: true\n"))
        throw new Error(
          "Destination is a personal note. Choose another output folder.",
        );
      if (
        state.publishedHash &&
        (await hash(previous)) !== state.publishedHash &&
        previous !== text
      )
        throw new Error(
          "Generated transcript was manually edited. Preserve those changes before retrying.",
        );
      if (!state.publishedHash && !before.legacy && previous !== text)
        throw new Error(
          "Existing generated transcript has no ownership record; choose another output folder.",
        );
    }
    const needsHistory =
      previous !== text &&
      previous &&
      state.historyRevision !== state.revision &&
      Object.keys(before.pages).length;
    if (needsHistory) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const historyPath = `Supernote Transcripts/History/${state.id.slice(0, 12)}/${stamp}-${crypto.randomUUID().slice(0, 8)}.md`;
      await this.ensureFolder(historyPath);
      await this.app.vault.create(historyPath, previous);
      this.store.history.push(historyPath);
      state.historyRevision = state.revision;
    }
    if ((await this.reader().revision(state.source)) !== state.revision)
      throw new Error(
        "Notebook changed before saving. Previous Markdown is preserved.",
      );
    if (previous !== text) {
      if (exists)
        await this.app.vault.adapter.process(path, (current) => {
          if (current !== previous)
            throw new Error(
              "Generated transcript was manually edited while saving.",
            );
          return text;
        });
      else await this.app.vault.create(path, text);
    }
    state.publishedHash = await hash(text);
    state.publishedPages = clone(state.desired);
    const io=this.sharedIO();if(io&&sharedId)await new PublicationReceipts(io).save(sharedId,text,state.desired,state.pages,this.presentationFor(state));
    if (previous !== text) state.lastSaved = new Date().toISOString();
    await this.persist();
  }
  private async checkOutput(state: NotebookState,before?:NotebookState,sharedId?:string) {
    if (await this.app.vault.adapter.exists(state.output)) {
      const text = await this.app.vault.adapter.read(state.output);
      if (!text.startsWith("---\nnomad_transcripts: true\n"))
        throw new Error(
          "Destination is a personal note. Choose another output folder.",
        );
      const actual = await hash(text);
      const io=this.sharedIO(),receipt=io&&sharedId?await new PublicationReceipts(io).findHash(sharedId,actual):undefined;
      const observedInventory = receipt && (canAdvancePublication(receipt,state.desired,before?.desired??[]) ||
        canAdvancePublication(receipt,state.desired,state.publishedPages??[]));
      const legacyAppend = receipt && this.ownedLegacyAppend(state, receipt, actual) &&
        await canAdoptPublication(receipt, state.desired, state.pages);
      if(receipt&&!observedInventory&&!legacyAppend)throw Error("Shared transcript has a newer or conflicting page inventory. Wait for source synchronization before retrying.");
      if(receipt&&!await canAdoptPublication(receipt,state.desired,state.pages)&&!await canAdoptPublication(receipt,state.desired,before?.pages??{}))throw Error("Shared transcript results have not arrived or conflict with local results. Wait for synchronization before retrying.");
      if(receipt?.presentation && state.publishedHash !== actual) {
        if(Object.entries(receipt.presentation.cleanedPages).some(([id,p])=>{
          const page=state.desired.find(d=>d.id===id);
          return page?.fingerprint===p.fingerprint&&pageTextLayer(state,page).text!==p.baseText&&before?.pages[id]?.text!==p.baseText;
        }))throw Error("This cleaned transcript uses page results that have not arrived on this device. Wait for shared results before updating; the cleaned text is preserved.");
        state.cleanedPages=Object.fromEntries(Object.entries(receipt.presentation.cleanedPages).filter(([id,p])=>{
          const page=state.desired.find(d=>d.id===id);
          return page?.fingerprint===p.fingerprint&&pageTextLayer(state,page).text===p.baseText;
        }));
        state.cleanup=clone(receipt.presentation.cleanup);
      }
      if (legacyAppend) {
        state.publishedPages = receipt!.pages.map((p, i) => ({ ...p, number: i + 1 }));
        await this.persist();
      }
      if (state.publishedHash !== actual) {
        if (text === buildMarkdown(state,this.showPageHeadings) || text===buildMarkdown(state,!this.showPageHeadings)) {
          state.publishedHash = actual;
          state.publishedPages = clone(state.desired);
          await this.persist();
        } else {
          if(receipt&&observedInventory){
            state.publishedHash=actual;
            state.publishedPages=receipt.pages.map((p,i)=>({...p,number:i+1}));
            await this.persist();return;
          }
          throw new Error(
            "Generated transcript was manually edited or has no ownership record. Preserve it or choose another output folder before retrying.",
          );
        }
      }
    }
  }
  private async relocateOutput(
    state: NotebookState,
    destination: string,
    retainModified = false,
  ) {
    if (state.output === destination) return;
    validateDestination(destination);
    if (await this.app.vault.adapter.exists(destination))
      throw new Error(
        "New destination already exists. Choose another output folder.",
      );
    if (await this.app.vault.adapter.exists(state.output)) {
      try {
        await this.checkOutput(state);
      } catch (error) {
        if (!retainModified) throw error;
        state.output = destination;
        state.publishedHash = undefined;
        await this.persist();
        return;
      }
      await this.ensureFolder(destination);
      await this.app.vault.adapter.rename(state.output, destination);
    }
    state.output = destination;
    await this.persist();
  }
  private async transcribe(
    image: string,
    page: number,
    profile: Profile,
    reference: string,
    source: string,
    recipe = "",
    claimReady: () => Promise<boolean> = async()=>true,
    fingerprint?:string,
    group?: {targets:{id:string;number:number;fingerprint:string}[];images:{label:string;image:string}[];prompt:string;completedPages?:number;usedModel?:string;textOnly?:boolean;maxOutputTokens?:number},
  ) {
    this.assertStateReady();
    if (!this.aiEnabled) throw new Error("AI recognition is switched off.");
    const quality=qualitySettings(profile.quality);
    const reasoningEffort=/^gpt-(?:5|6)(?:[.-]|$)/.test(profile.model)&&(this.provider==="subscription"||endpointKey(profile.endpoint)==="https://api.openai.com/v1/responses")?quality.reasoningEffort:undefined;
    const maxOutputTokens=group?.maxOutputTokens??(group?recognitionOutputAllowance(quality.mode,group.targets.length,this.costs.settings.maxOutputTokens,profile.model,this.provider==="subscription"||endpointKey(profile.endpoint)==="https://api.openai.com/v1/responses"):this.costs.settings.maxOutputTokens);
    const targets=group?.targets.map(p=>({pageId:p.id,page:p.number,fingerprint:p.fingerprint}));
    const acceptedCount=(text:string)=>group?parseRecognitionGroup(text,group.targets).results.length:1;
    if(this.provider==="subscription"){
      if(!await claimReady())return null;
      let reservation:string|undefined;
      try{
        const result=await this.session.recognize(profile.model,image,group?.prompt??`${profile.prompt}${reference}\n\n${TRANSCRIPTION_RESPONSE_RULES}\n\nTranscribe page ${page}.`,async()=>{
          if(!await claimReady())return false;
          if(this.stop||this.disposed||!this.active||!this.aiEnabled||this.sourcePaused(source)||this.progress.budgetBlocked||this.progress.executionBlocked)return false;
          reservation=this.subscriptionBook.reserve(source,profile.model,recipe,this.costs.settings.dailyRequests,this.store.notebooks[source]?.desired.find(p=>p.number===page)?.id,page,fingerprint,targets);this.callsThisRun++;this.stage(group?.textOnly?"Cleaning document":"Recognizing",`${source.split("/").pop()} — ${group?.textOnly?"one text-only request":group?`pages ${group.targets.map(p=>p.number).join(", ")}`:`page ${page}`}`);this.emit();return true;
        },group?{images:group.images,reasoningEffort,maxOutputTokens,textOnly:group.textOnly}:undefined);
        if(!result)return null;
        if(group)group.usedModel=result.model??profile.model;
        try{this.subscriptionBook.finish(reservation!,result,true,acceptedCount(result.text));}catch(error){this.progress.budgetBlocked=readable(error);}
        this.emit();return result.text;
      }catch(error){if(reservation)try{this.subscriptionBook.finish(reservation,isRecognitionFailure(error)&&error.outcomeKnown?{usage:error.usage}:undefined,false);}catch(storageError){throw new BudgetBlocked(readable(storageError));}throw error;}
    }
    if (!this.apiKey)
      throw new RecognitionFailure("provider","Add an API key in Supernote Transcripts settings.",{scope:"batch"});
    let url:URL;try{url=new URL(profile.endpoint);}catch{throw new RecognitionFailure("provider","Set a valid API endpoint for this profile.",{scope:"source"});}
    if (url.protocol !== "https:")
      throw new RecognitionFailure("provider","The API endpoint must use HTTPS.",{scope:"source"});
    this.costBook.assertReady();
    const price = priceFor(
      profile.endpoint,
      profile.model,
      this.costs.settings,
    );
    if (!price)
      throw new BudgetBlocked(
        "Set token prices for this model and endpoint in Costs and limits before recognition.",
      );
    const input = [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: group?.prompt??`${profile.prompt}${reference}\n\n${TRANSCRIPTION_RESPONSE_RULES}\n\nTranscribe page ${page}.`,
          },
          ...(group?group.images.flatMap(item=>[{type:"input_text",text:item.label},{type:"input_image",image_url:item.image,detail:"original"}]):[{ type: "input_image", image_url: image, detail: "original" }]),
        ],
      },
    ];
    this.stage(
      "Checking request cost",
      `${source.split("/").pop()} — page ${page}`,
    );
    let tokenCount;
    try {
      tokenCount = await requestUrl({
        url: `${endpointKey(profile.endpoint)}/input_tokens`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: profile.model, input }),
        throw: false,
      });
    } catch {
      throw new BudgetBlocked(
        "Could not check input tokens. No recognition request was sent.",
      );
    }
    if(tokenCount.status>=400)throw providerFailure(tokenCount.status,tokenCount.json);
    if (
      !Number.isSafeInteger(tokenCount.json?.input_tokens) ||
      tokenCount.json.input_tokens < 0
    )
      throw new BudgetBlocked(
        "The API did not provide a valid input token count. No recognition request was sent.",
      );
    if(group?.textOnly&&tokenCount.json.input_tokens>100000)throw new BudgetBlocked("This document exceeds the single-pass cleanup limit of 100,000 input tokens. No cleanup request was sent.");
    if (
      !this.aiEnabled ||
      this.stop ||
      this.disposed ||
      !this.active ||
      this.sourcePaused(source)
      || !!this.progress.budgetBlocked
      || !!this.progress.executionBlocked
    )
      return null;
    if(!await claimReady())return null;
    if(this.stop||this.disposed||!this.active||!this.aiEnabled||this.sourcePaused(source)||this.progress.budgetBlocked||this.progress.executionBlocked)return null;
    const admissionPrice = priceFor(
      profile.endpoint,
      profile.model,
      this.costs.settings,
    );
    if (!admissionPrice)
      throw new BudgetBlocked(
        "Set token prices for this model and endpoint before recognition.",
      );
    const reservation = this.costBook.reserve(
      source,
      page,
      profile.model,
      admissionPrice,
      tokenCount.json.input_tokens,
      recipe,
      fingerprint?{pageId:this.store.notebooks[source]?.desired.find(p=>p.number===page)?.id??"",fingerprint}:undefined,
      targets,maxOutputTokens,
    );
    this.emit();
    this.callsThisRun++;
    this.stage(group?.textOnly?"Cleaning document":"Recognizing",`${source.split("/").pop()} — ${group?.textOnly?"one text-only request":group?`pages ${group.targets.map(p=>p.number).join(", ")}`:`page ${page}`}`);
    // Do not abandon a charged request merely because our own timer expired.
    const warning = setTimeout(
      () =>
        this.stage(
          "Waiting for AI",
          "The current request is taking longer than usual. Its result will be saved when it returns.",
        ),
      120000,
    );
    let result;
    try {
      result = await requestUrl({
        url: url.toString(),
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: profile.model,
          store: false,
          max_output_tokens: maxOutputTokens,
          ...(reasoningEffort?{reasoning:{effort:reasoningEffort}}:{}),
          service_tier: "default",
          ...(group&&reasoningEffort?{text:{format:{type:"json_schema",name:"supernote_transcription",strict:true,schema:{type:"object",properties:{pages:{type:"array",items:{type:"object",properties:{number:{type:"integer",enum:group.targets.map(p=>p.number)},text:{type:"string"},joinPrevious:{type:"boolean"}},required:["number","text","joinPrevious"],additionalProperties:false}}},required:["pages"],additionalProperties:false}}}}:{}),
          input,
        }),
        throw: false,
      });
    } catch (error) {
      this.costBook.finish(reservation, null, false);
      this.emit();
      throw new RecognitionFailure("transport","Recognition connection was interrupted. Retry this page explicitly.");
    } finally {
      clearTimeout(warning);
    }
    if (result.status >= 400) {
      this.costBook.finish(reservation, result.json, false);
      this.emit();
      throw providerFailure(result.status,result.json);
    }
    let text;
    try {
      text = completedResponse(result.json).text;
      if(group)group.usedModel=typeof result.json?.model==="string"&&result.json.model.length<=200?result.json.model:profile.model;
    } catch (error) {
      this.costBook.finish(reservation, result.json, false);
      this.emit();
      throw error;
    }
    // Preserve a successful paid transcript even if saving its accounting
    // fails. The existing reservation survives restart; all new work stops.
    try {
      this.costBook.finish(reservation, result.json, true,acceptedCount(text));
    } catch (error) {
      this.progress.budgetBlocked = readable(error);
    }
    this.progress.budgetBlocked ??= this.costs.issue;
    this.emit();
    return text;
  }
  private assertSharedSettings(source: string) {
    const rule=ruleFor(source,this.config.rules),issue=this.sharedSettingsIssues.find(i=>i.ruleId===rule?.id);
    if(issue)throw Error("Resolve this source's shared settings before recognition: choose Keep this device or Use synced settings in Sources.");
  }
  private sourcePaused(source: string) {
    const rule = ruleFor(source, this.config.rules);
    return (
      !this.sourceSelected(source) ||
      this.sharedSettingsIssues.some(issue=>issue.ruleId===rule?.id) ||
      (this.automaticRun && rule?.autoRecognize === false) ||
      !!rule?.paused ||
      !!this.store.notebooks[source]?.paused
    );
  }
  async openNotebookPage(outputPath: string, pageId: string, displayNumber: number): Promise<void> {
    if (this.initializing || this.disposed) throw Error("The transcription plugin is still loading. Try the page link again shortly.");
    if (this.pageNavigation) return this.pageNavigation;
    const operation = (async () => {
      const target = await resolveNotePage({ outputPath, pageId, displayNumber }, {
        config: this.config, store: this.store, reader: this.reader(false),
        platform: this.platform,
        readTranscript: path => this.app.vault.adapter.read(path), sharedIO: this.sharedIO(),
      });
      if (this.disposed) return;
      if (this.platform === "nomad") window.open(notePageUrl(target));
      else {
        const root = (this.app.vault.adapter as any).getBasePath?.()?.replace(/\\/g,"/").replace(/\/$/,"");
        const path = target.path.replace(/\\/g,"/");
        const plugins = (this.app as any).plugins?.plugins ?? {};
        if (root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`) &&
            (plugins["supernote-cloud-sync"] || plugins["supernote"] || plugins["supernote-obsidian-plugin"])) {
          await this.app.workspace.openLinkText(`${path.slice(root.length+1)}#page=${target.page}`, outputPath, true);
        } else {
          const reader=this.reader(false),opened=await reader.open(target.path);
          try {
            if(opened.descriptor.pages.find(p=>p.number===target.page)?.id!==target.pageId)throw Error("The notebook changed while opening its page. Tap the link again.");
            const image=await opened.render(target.page);
            if(await reader.revision(target.path)!==opened.descriptor.revision)throw Error("The notebook changed while rendering its page. Tap the link again.");
            new OriginalPagePreview(this.app,image,target.page).open();
          } finally {opened.close();}
        }
      }
    })();
    this.pageNavigation = operation;
    try { await operation; }
    finally { if (this.pageNavigation === operation) this.pageNavigation = undefined; }
  }
  async preview(path: string, page: number) {
    if (this.task)
      throw new Error(
        "Pause and wait for the current update before previewing.",
      );
    const opened = await this.reader().open(path);
    try {
      pagesFromRange(String(page), opened.descriptor.pages.length);
      return await opened.render(page);
    } finally {
      opened.close();
    }
  }
  reprocessEstimate(source: string, range: string, outdatedOnly = false) {
    const state=this.store.notebooks[source],rule=ruleFor(source,this.config.rules);
    if(!state||!rule)throw Error("Update this source before choosing pages.");
    let selected=range.trim()?selectedPageNumbers(range,state.desired.length):outdatedOnly?state.desired.map(p=>p.number):[];
    if(outdatedOnly){const recipe=this.recipes.get(rule.profileId);selected=selected.filter(n=>{const p=state.desired[n-1],r=state.pages[p.id];return !r||r.fingerprint!==p.fingerprint||!recipe||r.recipe!==recipe;});}
    return this.queueEstimate(source,selected);
  }
  async reprocessPages(source: string, range: string, outdatedOnly = false) {
    this.assertStateReady();
    if(this.task)throw Error("Pause and wait for active work before re-recognizing pages.");
    await this.refreshSharedSettings();
    this.assertSharedSettings(source);
    const state=this.store.notebooks[source],rule=ruleFor(source,this.config.rules);
    if(!state||!rule||!this.sourceSelected(source))throw Error("Update this source once before selecting pages.");
    if(this.sourcePaused(source))throw Error("Resume this source before re-recognizing its pages.");
    const resolved=await this.profile(rule.profileId);
    let numbers=range.trim()?selectedPageNumbers(range,state.desired.length):outdatedOnly?state.desired.map(p=>p.number):[];
    if(outdatedOnly)numbers=numbers.filter(n=>{const p=state.desired[n-1],r=state.pages[p.id];return !r||r.fingerprint!==p.fingerprint||r.recipe!==resolved.recipe;});
    if(!numbers.length)throw Error(outdatedOnly?"All selected pages already use the current recognition settings.":"Enter pages such as 3, 8-12.");
    await this.manual(source,numbers,true,numbers.map(n=>state.desired[n-1].id));
  }
  cleanupEstimate(source: string) {
    const state=this.store.notebooks[source],rule=ruleFor(source,this.config.rules),profile=this.config.profiles.find(p=>p.id===rule?.profileId);
    if(!state||!profile)return {pages:0,requests:0,samples:0,provisional:true};
    const chars=buildMarkdown(state,false).length+profile.prompt.length+profile.glossaries.length*4000;
    const output=Math.min(128000,Math.max(8192,Math.ceil(chars/2)+8192));
    const price=this.provider==="api"?priceFor(profile.endpoint,profile.model,this.costs.settings):undefined;
    return {pages:state.desired.length,requests:1,samples:0,provisional:true,
      ...(price?{usd:((chars/2+1000)*price.input+output*price.output)/1e6}:{} )};
  }
  async cleanupDocument(source: string, options: {saveCopy?:boolean} = {}) {
    this.assertStateReady();this.assertAttemptStorageReady();
    if(this.task)throw Error("Pause and wait for active requests before cleaning a document.");
    await this.refreshSharedSettings();
    this.assertSharedSettings(source);
    if(!this.aiEnabled)throw Error("Switch on AI recognition before cleaning a document.");
    const original=this.store.notebooks[source],rule=ruleFor(source,this.config.rules);
    if(!original||!rule||!this.sourceSelected(source))throw Error("Choose an enabled notebook with a mirrored transcript.");
    if(this.sourcePaused(source))throw Error("Resume this source before cleaning its document.");
    const wasPaused=this.progress.paused;
    this.stop=false;this.callsThisRun=0;this.costBook.beginRun();
    this.progress={...emptyProgress(),running:true,activeSource:source};
    this.setPaused(false);
    const operation=(async()=>{
      const resolved=await this.profile(rule.profileId),state=clone(original),reader=this.reader(false);
      if(state.desired.some(p=>state.pages[p.id]?.fingerprint!==p.fingerprint))throw Error("Finish AI recognition for every page before cleaning the complete document. Device OCR remains readable meanwhile.");
      const current=await this.app.vault.adapter.read(state.output);
      if(!isManagedTranscript(current))throw Error("Cleanup is available only for this notebook's generated transcript.");
      const opened=await reader.open(source);
      try {if(JSON.stringify(opened.descriptor.pages)!==JSON.stringify(state.desired))throw Error("The notebook has changed. Update its mirrored pages before cleanup.");}
      finally {opened.close();}
      const revision=await reader.revision(source);
      const signatureNow=()=>JSON.stringify([original.output,original.outputOverride,original.desired,original.pages,original.deviceOcr,ruleFor(source,this.config.rules),this.config.profiles.find(p=>p.id===rule.profileId),this.showPageHeadings]);
      const signature=signatureNow();
      const prompt=cleanupInput(state,current,resolved.profile.prompt,resolved.reference);
      if(prompt.length>400000)throw Error("This document and its references exceed the single-pass cleanup size limit. No request was sent.");
      const cleanupRecipe=`cleanup:${await hash(JSON.stringify([resolved.recipe,prompt]))}`;
      const assertCurrent=async()=>{
        if(this.store.notebooks[source]!==original||signatureNow()!==signature||(await this.profile(rule.profileId)).recipe!==resolved.recipe||await reader.revision(source)!==revision||await this.app.vault.adapter.read(state.output)!==current)
          throw Error("The notebook, its settings, or transcript changed during cleanup. Current text was preserved.");
      };
      const io=this.sharedIO(),shared=this.shared,id=await notebookIdentity(rule.sharedId??rule.id,relativeToRule(source,rule));
      let lease:LeaseHandle|null=null,heartbeat:ReturnType<typeof setInterval>|undefined,lost=false;
      try {
        if(shared){lease=await shared.acquire(id);if(!lease)throw Error("Another device is updating this notebook. Try cleanup after it finishes.");heartbeat=setInterval(()=>{void shared.heartbeat(lease!).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;});},30000);}
        await assertCurrent();
        const request={targets:state.desired,images:[] as {label:string;image:string}[],prompt,textOnly:true,usedModel:resolved.profile.model,maxOutputTokens:Math.min(128000,Math.max(8192,Math.ceil(current.length/2)+8192))};
        const raw=await this.transcribe("",1,{...resolved.profile,quality:"careful"},resolved.reference,source,cleanupRecipe,async()=>{await assertCurrent();if(lost||shared&&lease&&!await shared.checkLease(lease))throw Error("Another device took priority. No cleanup request was sent.");return true;},undefined,request);
        if(raw===null){this.stage("Cleanup cancelled","No cleanup was sent. Your transcript is unchanged.");return;}
        const cleaned=cleanupPages(raw,state);
        state.cleanedPages=cleaned;
        const text=buildMarkdown(state,this.showPageHeadings);
        state.cleanup={updatedAt:new Date().toISOString(),inputHash:await hash(current),outputHash:await hash(text),model:request.usedModel,quality:"careful",provider:this.provider,basePages:clone(state.desired)};
        const stamp=new Date().toISOString().replace(/[:.]/g,"-");
        const backup=`Supernote Transcripts/History/${state.id.slice(0,12)}/${stamp}-${crypto.randomUUID().slice(0,8)}.md`;
        const recovered=backup.replace(/\.md$/,"-cleanup-result.md");
        await this.ensureFolder(backup);await this.app.vault.create(recovered,text);this.store.history.push(recovered);
        await this.app.vault.create(backup,current);this.store.history.push(backup);await this.persist();
        try {
        await assertCurrent();if(lost||shared&&lease&&!await shared.checkLease(lease))throw Error("Another device took priority while cleanup was running.");
        if(options.saveCopy){
          const stem=state.output.replace(/\.md$/i,"");let copy=`${stem} (cleaned).md`,n=1;
          while(await this.app.vault.adapter.exists(copy))copy=`${stem} (cleaned ${++n}).md`;
          await this.app.vault.create(copy,text);
          if(io)await new PublicationReceipts(io).save(id,text,state.desired,state.pages,this.presentationFor(state));
          this.stage("Cleanup saved",`Cleaned copy: ${copy}`);
        } else {
          // Cache the paid result before writing. A failed publication can be recovered without another request.
          original.cleanedPages=state.cleanedPages;original.cleanup=state.cleanup;await this.persist();
          await assertCurrent();
          this.stage("Saving cleanup",state.output);
          await this.app.vault.adapter.process(state.output,value=>{if(value!==current||this.store.notebooks[source]!==original||signatureNow()!==signature)throw Error("Transcript or settings changed before cleanup could save. Its current text was preserved.");return text;});
          original.publishedHash=await hash(text);original.publishedPages=clone(original.desired);original.lastSaved=new Date().toISOString();
          delete original.error;original.status=pendingPages(original).length?"queued":"current";
          if(io)await new PublicationReceipts(io).save(id,text,original.desired,original.pages,this.presentationFor(original));
          await this.persist();this.stage("Document cleaned","Saved in place. The previous version is in History; new pages can append normally.");
        }
        } catch(error) { throw Error(`${readable(error)} The paid cleanup result is saved at ${recovered}; open it instead of sending another request.`); }
      } finally {if(heartbeat)clearInterval(heartbeat);if(shared&&lease)await shared.release(lease);}
    })();
    this.task=operation;
    try {await operation;}catch(error){if(error instanceof BudgetBlocked)this.progress.budgetBlocked=readable(error);this.stage(error instanceof BudgetBlocked?"Spending paused":"Cleanup needs attention",readable(error));throw error;}
    finally {this.task=null;this.progress.running=false;delete this.progress.activeSource;this.setPaused(wasPaused||this.stop);this.emit();}
  }
  async manual(path: string, range: string | number[], force = false, selectedIds?: string[]) {
    this.assertStateReady();
    this.assertAttemptStorageReady();
    if (force && !this.aiEnabled)
      throw new Error(
        "Switch on AI recognition before requesting reprocessing.",
      );
    if (this.task) throw new Error("An update is already running.");
    await this.refreshSharedSettings();
    this.assertSharedSettings(path);
    if(this.task)throw Error("An update is already running.");
    this.validateConfig();
    const rule = ruleFor(path, this.config.rules);
    const relative = rule ? path.slice(rule.source.length + 1) : "";
    if (
      !rule ||
      excluded(path, rule.source, rule.exclude) ||
      (!rule.recursive &&
        relative.includes("/") &&
        !rule.source.endsWith(".note"))
    )
      throw new Error("This notebook is not in an enabled source.");
    const entry = {
      path,
      relative: path.split("/").pop()!,
      ruleId: rule.id,
      profileId: rule.profileId,
      output: mirrorPath(path, rule),
      size: 0,
      mtime: 0,
    };
    this.stop = false;
    this.callsThisRun = 0;
    this.setPaused(false);
    this.costBook.beginRun();
    this.progress = { ...emptyProgress(), running: true };
    this.progress.activeSource = path;
    const task = this.processNotebook(entry, force, Array.isArray(range)?Infinity:10, selectedIds?undefined:range,selectedIds).then(
      async () => {
        if (this.store.notebooks[path].status === "queued") this.enqueue(path);
        await this.persist();
        this.stage(
          this.progress.budgetBlocked
            ? "Spending paused"
            : this.stop
              ? "Paused"
              : !this.active
                ? "Waiting for Obsidian"
                : "Selection saved",
          this.progress.budgetBlocked ??
            (this.stop
              ? "Successful pages are saved. Resume to continue."
              : !this.active
                ? "Successful pages are saved. Return to Obsidian to continue."
                : "Selected pages saved locally. Obsidian Sync handles delivery."),
        );
      },
    );
    this.task = task;
    try {
      await task;
    } catch (error) {
      const state = this.store.notebooks[path];
      if (error instanceof BudgetBlocked) {
        if (state) {
          state.status = "queued";
          delete state.error;
          this.enqueue(path);
        }
        this.progress.budgetBlocked = readable(error);
        this.stage("Spending paused", readable(error));
      } else if (state) {
        state.status = /manually edited|Shared transcript|publication receipt|ownership record/i.test(readable(error))
          ? "conflict"
          : "failed";
        state.error = readable(error);
      }
      if (!(error instanceof BudgetBlocked))
        this.stage("Needs attention", readable(error));
      await this.persist();
      throw error;
    } finally {
      this.task = null;
      this.progress.running = false;
      delete this.progress.activeSource;
      this.emit();
    }
  }
  async openOutput(path: string) {
    await this.app.workspace.openLinkText(path, "", true);
  }
}
