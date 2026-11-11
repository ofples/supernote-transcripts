import test from "node:test";
import assert from "node:assert/strict";
import { RecognitionFailure, providerFailure } from "../src/subscription-stream.mjs";
import { retryDelayMs, withRecoverableRetries } from "../src/recoverable-retries.mjs";

test("overload, rate limiting, and confirmed server errors are retryable with Retry-After", () => {
  for (const error of [
    providerFailure(503, { error: { code: "server_is_overloaded" } }),
    providerFailure(429, { error: { code: "rate_limit_exceeded" } }),
    providerFailure(502, { error: { message: "Temporary provider failure" } }),
  ]) assert.equal(error.retryable, true);
  assert.equal(providerFailure(503, {}, { "retry-after": "0" }).retryAfterMs, 0);
  assert.equal(providerFailure(503, {}, { "retry-after": "60" }).retryAfterMs, 60000);
  assert.equal(providerFailure(503, {}, { "retry-after": "121" }).retryable, false);
  assert.match(providerFailure(503, {}, { "retry-after": "121" }).message, /retry this page manually after that wait/i);
});

test("authentication, quota, invalid model, and ambiguous failures are never retryable", () => {
  for (const error of [
    providerFailure(401, { error: { code: "invalid_api_key" } }),
    providerFailure(429, { error: { code: "insufficient_quota" } }),
    providerFailure(429, { error: { code: "billing_hard_limit" } }),
    providerFailure(429, { error: { message: "You exceeded your current quota." } }),
    providerFailure(400, { error: { code: "invalid_model" } }),
    new RecognitionFailure("transport", "Connection interrupted"),
    new RecognitionFailure("missing_terminal", "No terminal event"),
  ]) assert.notEqual(error.retryable, true);
});

test("success after one recoverable response performs only the configured retry", async () => {
  let attempts = 0;
  const value = await withRecoverableRetries(async () => {
    attempts++;
    if (attempts === 1) throw providerFailure(503, { error: { code: "server_is_overloaded" } });
    return "completed";
  }, { retries: 1, sleep: async () => {}, random: () => 0 });
  assert.equal(value, "completed");
  assert.equal(attempts, 2);
  assert.equal(retryDelayMs({ retryAfterMs: 0 }, 0), 0);
});

test("retry exhaustion is bounded and pause during the delay prevents another send", async () => {
  let attempts = 0;
  await assert.rejects(withRecoverableRetries(async () => {
    attempts++;
    throw providerFailure(503, { error: { code: "server_is_overloaded" } });
  }, { retries: 2, sleep: async () => {}, random: () => 0 }), /could not complete/i);
  assert.equal(attempts, 3);

  let continuing = true; attempts = 0;
  const stopped = await withRecoverableRetries(async () => {
    attempts++;
    throw providerFailure(503, { error: { code: "server_is_overloaded" } }, { "retry-after": "2" });
  }, { retries: 5, shouldContinue: () => continuing, sleep: async () => { continuing = false; } });
  assert.equal(stopped, null);
  assert.equal(attempts, 1);
});
