import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({
  entryPoints: ["src/cost.ts"],
  outfile: "test-artifacts/cost-test.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
});
const {
  CostBook,
  BudgetBlocked,
  STANDARD_PRICES,
  DEFAULT_COST_SETTINGS,
  priceFor,
  reservationMicros,
  usageFrom,
  usageMicros,
} = await import("../test-artifacts/cost-test.mjs");
const price = STANDARD_PRICES[0],
  source = "/storage/emulated/0/Note/Work/a.note";
function fixture() {
  const map = new Map();
  let clock = new Date("2026-10-06T12:00:00Z");
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
  };
  const make = () => new CostBook(storage, "ledger", () => clock);
  const book = make();
  book.beginRun();
  return { book, storage, map, make, setTime: (t) => (clock = new Date(t)) };
}
const response = (
  input = 1000,
  output = 30,
  cached = 0,
  cacheWrite = 0,
  reasoning = 0,
) => ({
  model: "gpt-6.1-sol",
  service_tier: "default",
  usage: {
    input_tokens: input,
    output_tokens: output,
    input_tokens_details: {
      cached_tokens: cached,
      cache_write_tokens: cacheWrite,
    },
    output_tokens_details: { reasoning_tokens: reasoning },
    total_tokens: input + output,
  },
});
test("known prices apply only to the exact standard provider/model; overrides are explicit", () => {
  assert.equal(
    priceFor(price.endpoint, price.model, DEFAULT_COST_SETTINGS).input,
    2,
  );
  assert.equal(
    priceFor(
      "https://other.invalid/v1/responses",
      price.model,
      DEFAULT_COST_SETTINGS,
    ),
    undefined,
  );
  assert.equal(
    priceFor(price.endpoint, "unknown-model", DEFAULT_COST_SETTINGS),
    undefined,
  );
});
test("billing separates cache reads/writes and counts reasoning once", () => {
  const usage = usageFrom(response(1000, 30, 200, 100, 25));
  assert.equal(usageMicros(price, usage), 1970);
  assert.equal(usageFrom(response(100, 10, 80, 80)), undefined);
  assert.equal(usageFrom(response(100, 10, 0, 0, 11)), undefined);
  assert.equal(
    usageFrom({ usage: { input_tokens: NaN, output_tokens: 10 } }),
    undefined,
  );
});
test("reservation covers all output, cache writes, regional headroom and long context", () => {
  assert.equal(
    reservationMicros(price, 1000, 4096),
    Math.ceil((2500 + 40960) * 1.1),
  );
  assert.equal(
    reservationMicros(price, 272001, 4096),
    Math.ceil((272001 * 5 + 4096 * 15) * 1.1),
  );
});
test("a request is persisted before sending and held amounts enforce limits", () => {
  const f = fixture();
  f.book.saveSettings({
    ...DEFAULT_COST_SETTINGS,
    dailyUsd: 0.05,
    monthlyUsd: 1,
    runUsd: 1,
  });
  f.book.reserve(source, 1, price.model, price, 1000);
  assert.equal(JSON.parse(f.map.get("ledger")).entries[0].status, "reserved");
  assert.throws(
    () => f.book.reserve(source, 2, price.model, price, 1000),
    BudgetBlocked,
  );
  assert.equal(f.book.snapshot().total.requests, 1);
});
test("settling frees unused reservation while preserving total token-derived cost", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, response(), true);
  assert.equal(f.book.snapshot().total.heldUsd, 0);
  assert.equal(f.book.snapshot().total.spentUsd, 0.0023);
  assert.equal(f.book.snapshot().total.pages, 1);
});
test("output cache/profile reuse without reserve does not add costs", () => {
  const f = fixture();
  const before = f.book.snapshot();
  f.book.snapshot();
  f.book.beginRun();
  assert.deepEqual(f.book.snapshot().total, before.total);
});
test("daily request caps persist across new runs", () => {
  const f = fixture();
  f.book.saveSettings({ ...DEFAULT_COST_SETTINGS, dailyRequests: 1 });
  const id = f.book.reserve(source, 1, price.model, price, 100);
  f.book.finish(id, response(100, 1), true);
  f.book.beginRun();
  assert.throws(() => f.book.assertReady(), /Daily request limit/);
});
test("daily and monthly limits reset by calendar periods without erasing history", () => {
  const f = fixture();
  const id = f.book.reserve(source, 1, price.model, price, 100);
  f.book.finish(id, response(100, 1), true);
  f.setTime("2026-10-07T12:00:00Z");
  assert.equal(f.book.snapshot().day.requests, 0);
  assert.equal(f.book.snapshot().month.requests, 1);
  f.setTime("2026-11-01T12:00:00Z");
  assert.equal(f.book.snapshot().month.requests, 0);
  assert.equal(f.book.snapshot().total.requests, 1);
});
test("run limits reset for a new explicit update but daily totals remain", () => {
  const f = fixture();
  const id = f.book.reserve(source, 1, price.model, price, 100);
  f.book.finish(id, response(100, 1), true);
  f.book.beginRun();
  assert.equal(f.book.snapshot().run.requests, 0);
  assert.equal(f.book.snapshot().day.requests, 1);
});
test("interrupted and missing-usage requests remain held after restart", () => {
  const f = fixture();
  f.book.reserve(source, 1, price.model, price, 1000);
  const restart = f.make();
  assert.equal(restart.snapshot().unconfirmed, 1);
  assert.doesNotThrow(() => restart.assertReady());
  const held = restart.snapshot().total.heldUsd;
  restart.resolveUnconfirmed();
  assert.equal(restart.snapshot().total.spentUsd, held);
  assert.equal(restart.snapshot().total.pages, 0);
  assert.equal(restart.snapshot().unconfirmed, 0);
});
test("failed, incomplete, or unexpected tier responses are not reported as free", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, null, false);
  assert.equal(f.book.snapshot().total.spentUsd, 0);
  assert.ok(f.book.snapshot().total.heldUsd > 0);
  assert.doesNotThrow(() => f.book.assertReady());
  const g = fixture(),
    gid = g.book.reserve(source, 1, price.model, price, 1000);
  g.book.finish(gid, { ...response(), service_tier: "priority" }, true);
  assert.equal(g.book.snapshot().unconfirmed, 1);
});
test("unknown monetary ceilings admit headroom but still prevent over-budget dispatch",()=>{
  const f=fixture(),id=f.book.reserve(source,1,price.model,price,1000);f.book.finish(id,null,false);
  const ceiling=f.book.snapshot().total.heldUsd;assert.ok(ceiling>0);f.book.saveSettings({...f.book.snapshot().settings,dailyUsd:ceiling*2.1});
  const second=f.book.reserve(source,2,price.model,price,1000);f.book.finish(second,null,false);assert.equal(f.book.snapshot().total.requests,2);assert.equal(f.book.snapshot().total.heldUsd,ceiling*2);
  assert.throws(()=>f.book.reserve(source,3,price.model,price,1000),/Daily limit cannot cover/);assert.equal(f.make().snapshot().total.requests,2);
});
test("failed transcription with valid usage is charged but not counted as a successful page", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, response(), false);
  assert.equal(f.book.snapshot().total.pages, 0);
  assert.equal(f.book.snapshot().total.spentUsd, 0.0023);
});
test("changing rates does not retroactively change saved costs", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, response(), true);
  f.book.saveSettings({
    ...DEFAULT_COST_SETTINGS,
    prices: [{ ...price, input: 99, output: 99 }],
  });
  assert.equal(f.book.snapshot().total.spentUsd, 0.0023);
});
test("lowered or zero limits block the next request without deleting history", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, response(), true);
  f.book.saveSettings({ ...DEFAULT_COST_SETTINGS, dailyUsd: 0 });
  assert.throws(() => f.book.assertReady(), /Daily spending limit/);
  assert.equal(f.book.snapshot().total.pages, 1);
});
test("corrupt and unavailable storage block rather than silently resetting spending", () => {
  const f = fixture();
  f.map.set("ledger", "broken");
  assert.throws(() => f.make().assertReady(), BudgetBlocked);
  const broken = new CostBook(
    {
      getItem: () => null,
      setItem: () => {
        throw Error("Full");
      },
    },
    "ledger",
  );
  broken.beginRun();
  assert.throws(
    () => broken.reserve(source, 1, price.model, price, 1000),
    /could not be saved/,
  );
});
test("analytics group requests by notebook and model without note content or credentials", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, response(), true);
  const s = f.book.snapshot();
  assert.equal(s.notebooks[0].source, source);
  assert.equal(s.models[0].model, price.model);
  assert.doesNotMatch(
    f.map.get("ledger"),
    /Authorization|image_url|handwriting|apiKey/,
  );
});
test("overflow estimates and malformed model fields fail closed", () => {
  assert.throws(
    () => reservationMicros({ ...price, input: Number.MAX_VALUE }, 1000, 4096),
    BudgetBlocked,
  );
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, { ...response(), model: 42 }, true);
  assert.equal(f.book.snapshot().unconfirmed, 1);
});
test("unexpected higher usage keeps a conservative hold until counted", () => {
  const f = fixture(),
    id = f.book.reserve(source, 1, price.model, price, 1000);
  f.book.finish(id, response(1000, 10000), true);
  assert.equal(f.book.snapshot().unconfirmed, 1);
  const known = f.book.snapshot().total.spentUsd;
  f.book.resolveUnconfirmed();
  assert.equal(f.book.snapshot().total.spentUsd, known);
  assert.equal(f.book.snapshot().total.heldUsd, 0);
});

test("request page identity and retry acknowledgment survive restart without releasing cost holds",()=>{
  const f=fixture();f.book.reserve(source,1,price.model,price,1000,'recipe',{pageId:'native:p',fingerprint:'fp'});
  const restarted=f.make();const before=restarted.snapshot().total;
  const copies=restarted.recoverableAttempts();assert.equal(copies[0].fingerprint,'fp');assert.equal(copies[0].status,'unconfirmed');
  copies[0].acknowledged=true;assert.equal(restarted.recoverableAttempts()[0].acknowledged,false);
  restarted.acknowledgeRecovery(source,'native:p','other');assert.equal(restarted.recoverableAttempts()[0].acknowledged,false);
  restarted.acknowledgeRecovery(source,'native:p','fp');assert.equal(f.make().recoverableAttempts()[0].acknowledged,true);
  assert.deepEqual(restarted.snapshot().total,before);assert.equal(restarted.snapshot().unconfirmed,1);
});

test("malformed request recovery metadata blocks accounting rather than silently discarding it",()=>{
  const f=fixture();f.book.reserve(source,1,price.model,price,1000,'recipe',{pageId:'p',fingerprint:'fp'});
  const raw=JSON.parse(f.map.get('ledger'));raw.entries[0].recoveryAcknowledged='yes';f.map.set('ledger',JSON.stringify(raw));
  const corrupt=f.make();assert.throws(()=>corrupt.recoverableAttempts(),BudgetBlocked);assert.throws(()=>corrupt.acknowledgeRecovery(source),BudgetBlocked);
});

 test("group reservations cover actual output and recover each target independently",()=>{
  const f=fixture();const targets=[{pageId:"p1",page:1,fingerprint:"f1"},{pageId:"p2",page:2,fingerprint:"f2"}];
  f.book.saveSettings({...DEFAULT_COST_SETTINGS,dailyUsd:10,monthlyUsd:100,runUsd:10});
  const id=f.book.reserve(source,1,price.model,price,1000,"recipe",undefined,targets,8192);
  const reserved=f.book.snapshot().recent[0];assert.equal(reserved.reservedMicros,reservationMicros(price,1000,8192));assert.equal(reserved.maxOutputTokens,8192);
  f.book.finish(id,response(),true,1);assert.equal(f.book.snapshot().total.requests,1);assert.equal(f.book.snapshot().total.pages,1);
  assert.equal(f.book.average(price.endpoint,price.model,"recipe").samples,1);
  f.book.acknowledgeRecovery(source,"p1","f1");const recovered=f.make().recoverableAttempts();assert.equal(recovered.length,2);assert.equal(recovered[0].acknowledged,true);assert.equal(recovered[1].acknowledged,false);
 });
