// Prices are USD per million tokens, Standard API, checked 2026-10-06.
// Sources and the distinction from an invoice are documented in COSTS.md.
export interface Price {
  endpoint: string;
  model: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  longThreshold: number;
  longInputMultiplier: number;
  longOutputMultiplier: number;
}
// This is the actual Responses output cap, including reasoning tokens.
export function recognitionOutputAllowance(quality: string | undefined, targets: number, perTarget: number, model: string, official = true) {
  const requested = Math.max(perTarget * targets, quality === "careful" ? 8192 : quality === "balanced" ? 4096 : 0);
  // Known GPT families share a conservative 128k upper bound. Custom providers
  // retain their configured allowance and are responsible for supporting it.
  return official && /^gpt-(?:5|6)(?:[.-]|$)/.test(model) ? Math.min(128000, requested) : requested;
}
export interface CostSettings {
  dailyUsd: number;
  monthlyUsd: number;
  runUsd: number;
  dailyRequests: number;
  maxOutputTokens: number;
  prices: Price[];
}
export interface TokenUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}
export interface RequestTarget { pageId: string; fingerprint: string; page: number; recoveryAcknowledged?: boolean }
export interface CostEntry {
  targets?: RequestTarget[];
  completedPages?: number;
  maxOutputTokens?: number;
  id: string;
  startedAt: string;
  day: string;
  month: string;
  run: string;
  source: string;
  page: number;
  model: string;
  price: Price;
  reservedMicros: number;
  costMicros?: number;
  usage?: TokenUsage;
  status: "reserved" | "complete" | "failed" | "unconfirmed" | "assumed";
  accepted?: boolean;
  recipe?: string;
  seconds?: number;
  pageId?: string;
  fingerprint?: string;
  recoveryAcknowledged?: boolean;
}
export interface CostTotals {
  spentUsd: number;
  heldUsd: number;
  requests: number;
  pages: number;
}
export interface CostSnapshot {
  startedAt: string;
  settings: CostSettings;
  day: CostTotals;
  month: CostTotals;
  run: CostTotals;
  total: CostTotals;
  notebooks: (CostTotals & { source: string })[];
  models: (CostTotals & { model: string })[];
  recent: CostEntry[];
  unconfirmed: number;
  issue?: string;
}
const ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_COST_SETTINGS: CostSettings = {
  dailyUsd: 1,
  monthlyUsd: 10,
  runUsd: 0.25,
  dailyRequests: 50,
  maxOutputTokens: 4096,
  prices: [],
};
export const STANDARD_PRICES: Price[] = [
  { model: "gpt-6.1-sol", input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
  {
    model: "gpt-6-luna",
    input: 0.1,
    cached: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
  },
  { model: "gpt-6-astra", input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
].map((p) => ({
  ...p,
  endpoint: ENDPOINT,
  longThreshold: 272000,
  longInputMultiplier: 2,
  longOutputMultiplier: 1.5,
}));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const natural = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
const micros = (usd: number) => Math.floor(usd * 1e6);
export class BudgetBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetBlocked";
  }
}
export function endpointKey(endpoint: string) {
  const u = new URL(endpoint);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.pathname.replace(/\/$/, "").endsWith("/responses")
  )
    throw new BudgetBlocked(
      "Use an HTTPS Responses endpoint without credentials or query parameters.",
    );
  return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
}
function validPrice(p: Price) {
  return (
    p &&
    typeof p.model === "string" &&
    p.model.trim() &&
    typeof p.endpoint === "string" &&
    [p.input, p.cached, p.cacheWrite, p.output].every(finite) &&
    natural(p.longThreshold) &&
    p.longThreshold > 0 &&
    finite(p.longInputMultiplier) &&
    p.longInputMultiplier >= 1 &&
    finite(p.longOutputMultiplier) &&
    p.longOutputMultiplier >= 1
  );
}
export function validateCostSettings(s: CostSettings) {
  if (
    !s ||
    ![s.dailyUsd, s.monthlyUsd, s.runUsd].every(
      (v) => finite(v) && v <= 100000,
    ) ||
    !natural(s.dailyRequests) ||
    s.dailyRequests > 100000 ||
    !natural(s.maxOutputTokens) ||
    s.maxOutputTokens < 256 ||
    s.maxOutputTokens > 4096 ||
    !Array.isArray(s.prices) ||
    !s.prices.every(validPrice)
  )
    throw new Error(
      "Enter valid spending limits and token prices. Zero disables new recognition; output limit must be 256–4096 tokens.",
    );
  const seen = new Set<string>();
  for (const p of s.prices) {
    const key = `${endpointKey(p.endpoint)}:${p.model}`;
    if (seen.has(key))
      throw new Error(
        "Only one price override is allowed per endpoint and model.",
      );
    seen.add(key);
  }
  return clone(s);
}
export function priceFor(
  endpoint: string,
  model: string,
  settings: CostSettings,
): Price | undefined {
  const key = endpointKey(endpoint);
  return (
    clone(
      settings.prices.find(
        (p) => endpointKey(p.endpoint) === key && p.model === model,
      ) ??
        STANDARD_PRICES.find((p) => p.endpoint === key && p.model === model) ??
        null,
    ) ?? undefined
  );
}
function rates(price: Price, input: number) {
  const long = input > price.longThreshold;
  return {
    i: long ? price.longInputMultiplier : 1,
    o: long ? price.longOutputMultiplier : 1,
  };
}
export function reservationMicros(
  price: Price,
  input: number,
  maxOutput: number,
) {
  if (!validPrice(price) || !natural(input) || !natural(maxOutput))
    throw new BudgetBlocked(
      "Token count or price is unavailable. No recognition was sent.",
    );
  const r = rates(price, input);
  // No cache discount assumed. Reserve every input token at the greatest
  // possible input rate, plus all permitted output, and 10% extra headroom.
  const amount = Math.ceil(
    (input * Math.max(price.input, price.cached, price.cacheWrite) * r.i +
      maxOutput * price.output * r.o) *
      1.1,
  );
  if (!natural(amount))
    throw new BudgetBlocked(
      "The page estimate is too large to calculate safely. No recognition was sent.",
    );
  return amount;
}
export function usageFrom(response: any): TokenUsage | undefined {
  const u = response?.usage;
  if (!u) return;
  const result = {
    input: u.input_tokens,
    output: u.output_tokens,
    cached: u.input_tokens_details?.cached_tokens ?? 0,
    cacheWrite: u.input_tokens_details?.cache_write_tokens ?? 0,
    reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
  };
  if (
    !Object.values(result).every(natural) ||
    result.cached + result.cacheWrite > result.input ||
    result.reasoning > result.output ||
    (u.total_tokens !== undefined &&
      u.total_tokens !== result.input + result.output)
  )
    return;
  return result;
}
export function usageMicros(price: Price, u: TokenUsage) {
  const r = rates(price, u.input);
  // output includes reasoning: do not add reasoning tokens twice.
  return Math.ceil(
    ((u.input - u.cached - u.cacheWrite) * price.input +
      u.cached * price.cached +
      u.cacheWrite * price.cacheWrite) *
      r.i +
      u.output * price.output * r.o,
  );
}
function periods(d: Date) {
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { day, month: day.slice(0, 7) };
}
function totals(entries: CostEntry[]): CostTotals {
  return {
    spentUsd: entries.reduce((n, e) => n + (e.costMicros ?? 0), 0) / 1e6,
    heldUsd:
      entries.reduce(
        (n, e) =>
          n +
          (e.status === "reserved" || e.status === "unconfirmed"
            ? Math.max(0, e.reservedMicros - (e.costMicros ?? 0))
            : 0),
        0,
      ) / 1e6,
    requests: entries.length,
    pages: entries.reduce((n,e)=>n+(e.completedPages ?? ((e.accepted ?? e.status === "complete")?1:0)),0),
  };
}
interface Ledger {
  version: 1;
  startedAt: string;
  settings: CostSettings;
  entries: CostEntry[];
}
export class CostBook {
  private ledger: Ledger;
  private error?: string;
  private run = "";
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem">,
    private key: string,
    private now = () => new Date(),
  ) {
    this.ledger = {
      version: 1,
      startedAt: this.now().toISOString(),
      settings: clone(DEFAULT_COST_SETTINGS),
      entries: [],
    };
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (
          parsed?.version !== 1 ||
          !Array.isArray(parsed.entries) ||
          typeof parsed.startedAt !== "string" ||
          !Number.isFinite(Date.parse(parsed.startedAt))
        )
          throw Error("Invalid spending record");
        validateCostSettings(parsed.settings);
        const ids = new Set<string>();
        for (const e of parsed.entries) {
          if (
            !e ||
            typeof e.id !== "string" ||
            ids.has(e.id) ||
            ![
              "reserved",
              "complete",
              "failed",
              "unconfirmed",
              "assumed",
            ].includes(e.status) ||
            !natural(e.reservedMicros) ||
            (e.costMicros !== undefined && !natural(e.costMicros)) ||
            (e.accepted !== undefined && typeof e.accepted !== "boolean") ||
            (e.pageId !== undefined && (typeof e.pageId !== "string" || !e.pageId)) ||
            (e.fingerprint !== undefined && (typeof e.fingerprint !== "string" || !e.fingerprint)) ||
            (e.recoveryAcknowledged !== undefined && typeof e.recoveryAcknowledged !== "boolean") ||
            (e.targets !== undefined && (!Array.isArray(e.targets) || !e.targets.length || e.targets.some((t:RequestTarget)=>!t || typeof t.pageId!=="string" || !t.pageId || typeof t.fingerprint!=="string" || !t.fingerprint || !natural(t.page) || t.page<1 || (t.recoveryAcknowledged!==undefined&&typeof t.recoveryAcknowledged!=="boolean")) || new Set(e.targets.map((t:RequestTarget)=>t.pageId)).size!==e.targets.length)) ||
            (e.maxOutputTokens !== undefined && (!natural(e.maxOutputTokens) || !e.maxOutputTokens)) ||
            (e.completedPages !== undefined && (!natural(e.completedPages) || e.completedPages>(e.targets?.length??1))) ||
            !validPrice(e.price) ||
            !Number.isFinite(Date.parse(e.startedAt)) ||
            typeof e.day !== "string" ||
            typeof e.month !== "string" ||
            typeof e.source !== "string" ||
            !natural(e.page) ||
            typeof e.model !== "string" ||
            typeof e.run !== "string" ||
            (["complete", "failed", "assumed"].includes(e.status) &&
              !natural(e.costMicros))
          )
            throw Error("Invalid spending entry");
          ids.add(e.id);
        }
        this.ledger = parsed;
        if (this.ledger.entries.some((e) => e.status === "reserved")) {
          this.ledger.entries.forEach((e) => {
            if (e.status === "reserved") e.status = "unconfirmed";
          });
          this.write();
        }
      }
    } catch {
      this.error =
        "The spending record could not be read safely. Recognition is blocked; preserve the device data and restore its spending record.";
    }
  }
  private write() {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.ledger));
    } catch {
      this.error =
        "The spending record could not be saved. Recognition is blocked.";
      throw new BudgetBlocked(this.error);
    }
  }
  beginRun() {
    this.run = `${this.now().toISOString()}-${crypto.randomUUID()}`;
  }
  snapshot(): CostSnapshot {
    const { day, month } = periods(this.now()),
      entries = this.ledger.entries;
    const group = (key: "source" | "model") =>
      [...new Set(entries.map((e) => e[key]))].map((value) => ({
        [key]: value,
        ...totals(entries.filter((e) => e[key] === value)),
      }));
    return {
      startedAt: this.ledger.startedAt,
      settings: clone(this.ledger.settings),
      day: totals(entries.filter((e) => e.day === day)),
      month: totals(entries.filter((e) => e.month === month)),
      run: totals(entries.filter((e) => e.run === this.run)),
      total: totals(entries),
      notebooks: group("source") as CostSnapshot["notebooks"],
      models: group("model") as CostSnapshot["models"],
      recent: clone(entries.slice(-30).reverse()),
      unconfirmed: entries.filter((e) => e.status === "unconfirmed").length,
      issue: this.error,
    };
  }
  saveSettings(settings: CostSettings) {
    if (this.error) throw new BudgetBlocked(this.error);
    this.ledger.settings = validateCostSettings(settings);
    this.write();
  }
  resolveUnconfirmed() {
    if (this.error) throw new BudgetBlocked(this.error);
    for (const e of this.ledger.entries)
      if (e.status === "unconfirmed") {
        e.status = "assumed";
        e.costMicros = Math.max(e.costMicros ?? 0, e.reservedMicros);
      }
    this.write();
  }
  assertReady() {
    const s = this.snapshot(),
      c = s.settings;
    if (s.issue) throw new BudgetBlocked(s.issue);
    for (const [period, t, limit] of [
      ["Daily", s.day, c.dailyUsd],
      ["Monthly", s.month, c.monthlyUsd],
      ["Update", s.run, c.runUsd],
    ] as const)
      if (micros(t.spentUsd + t.heldUsd) >= micros(limit))
        throw new BudgetBlocked(`${period} spending limit reached.`);
    if (s.day.requests >= c.dailyRequests)
      throw new BudgetBlocked("Daily request limit reached.");
  }
  reserve(
    source: string,
    page: number,
    model: string,
    price: Price,
    input: number,
    recipe?: string,
    identity?: { pageId: string; fingerprint: string },
    targets?: RequestTarget[],
    maxOutputTokens = this.ledger.settings.maxOutputTokens,
  ) {
    if(identity && (!identity.pageId || typeof identity.pageId !== "string" || !identity.fingerprint || typeof identity.fingerprint !== "string"))
      throw new BudgetBlocked("Request page identity is invalid. No request was sent.");
    if(targets && (!targets.length || targets.some(t=>typeof t.pageId!=="string"||!t.pageId||typeof t.fingerprint!=="string"||!t.fingerprint||!natural(t.page)||t.page<1)||new Set(targets.map(t=>t.pageId)).size!==targets.length))throw new BudgetBlocked("Request targets are invalid.");
    this.assertReady();
    const snap = this.snapshot(),
      settings = snap.settings,
      amount = reservationMicros(price, input, maxOutputTokens);
    for (const [period, t, limit] of [
      ["Daily", snap.day, settings.dailyUsd],
      ["Monthly", snap.month, settings.monthlyUsd],
      ["Update", snap.run, settings.runUsd],
    ] as const)
      if (Math.round((t.spentUsd + t.heldUsd) * 1e6) + amount > micros(limit))
        throw new BudgetBlocked(
          `${period} limit cannot cover the next request (up to $${(amount / 1e6).toFixed(4)}). Choose Fast or fewer selected pages, or raise the spending limit.`,
        );
    const date = this.now(),
      entry: CostEntry = {
        id: crypto.randomUUID(),
        startedAt: date.toISOString(),
        ...periods(date),
        run: this.run,
        source,
        page,
        model,
        price: clone(price),
        recipe,
        ...identity,
        ...(targets?{targets:clone(targets)}:{}),
        maxOutputTokens,
        reservedMicros: amount,
        status: "reserved",
      };
    this.ledger.entries.push(entry);
    this.write();
    return entry.id;
  }
  finish(id: string, response: any, success: boolean, completedPages?: number) {
    const entry = this.ledger.entries.find((e) => e.id === id);
    if (!entry)
      throw new BudgetBlocked("The request spending reservation is missing.");
    const usage = usageFrom(response),
      tier = response?.service_tier;
    const modelMatches =
      !response?.model ||
      response.model === entry.model ||
      (typeof response.model === "string" &&
        response.model.startsWith(`${entry.model}-20`));
    if(completedPages!==undefined&&(!natural(completedPages)||completedPages>(entry.targets?.length??1)))throw new BudgetBlocked("Completed page count is invalid.");
    entry.accepted = success;
    entry.completedPages = completedPages ?? (success?(entry.targets?.length??1):0);
    entry.seconds = Math.max(0,(this.now().getTime()-Date.parse(entry.startedAt))/1000);
    if (!usage || !modelMatches || (tier && tier !== "default"))
      entry.status = "unconfirmed";
    else {
      entry.usage = usage;
      const amount = usageMicros(entry.price, usage);
      if (natural(amount)) {
        entry.costMicros = amount;
        entry.status = success ? "complete" : "failed";
      } else entry.status = "unconfirmed";
    }
    if (
      entry.costMicros !== undefined &&
      entry.costMicros > entry.reservedMicros
    )
      entry.status = "unconfirmed";
    this.write();
  }
  recoverableAttempts() {
    if(this.error)throw new BudgetBlocked(this.error);
    return this.ledger.entries.flatMap(e=>(e.targets??[{pageId:e.pageId,fingerprint:e.fingerprint,recoveryAcknowledged:e.recoveryAcknowledged}]).map(t=>({id:e.id,source:e.source,pageId:t.pageId,fingerprint:t.fingerprint,recipe:e.recipe,status:e.status,started:Date.parse(e.startedAt),acknowledged:t.recoveryAcknowledged===true})));
  }
  acknowledgeRecovery(source:string,pageId?:string,fingerprint?:string) {
    if(this.error)throw new BudgetBlocked(this.error);
    let changed=false;
    for(const e of this.ledger.entries)if(e.source===source&&e.targets)for(const t of e.targets)if((pageId===undefined||(t.pageId===pageId&&t.fingerprint===fingerprint))&&!t.recoveryAcknowledged){t.recoveryAcknowledged=true;changed=true;}
    for(const e of this.ledger.entries)if(e.source===source && (pageId===undefined || (e.pageId===pageId && e.fingerprint===fingerprint)) && !e.recoveryAcknowledged){e.recoveryAcknowledged=true;changed=true;}
    if(changed)this.write();
  }
  average(endpoint: string, model: string, recipe?: string) {
    const rows=this.ledger.entries.filter(e=>e.status==="complete"&&e.accepted!==false&&e.model===model&&endpointKey(e.price.endpoint)===endpointKey(endpoint)&&(!recipe||e.recipe===recipe)).slice(-20);
    const pages=rows.reduce((n,e)=>n+(e.completedPages??1),0);
    return {samples:pages,usd:pages?rows.reduce((n,e)=>n+(e.costMicros??0),0)/pages/1e6:undefined,seconds:pages?rows.reduce((n,e)=>n+(e.seconds??0),0)/pages:undefined};
  }
}
