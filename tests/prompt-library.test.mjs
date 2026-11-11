import test from "node:test";
import assert from "node:assert/strict";
import {
  appendPromptRevision,
  duplicatePromptRevision,
  resolvePromptVersion,
  validatePromptLibrary,
} from "../src/prompt-library.mjs";

const createdAt = "2026-11-09T12:00:00.000Z";
const first = (scope = "recognition", overrides = {}) => appendPromptRevision([], {
  id: "faithful-transcription", name: "Faithful transcription", scope,
  text: "Preserve every word exactly.", ...overrides,
}, createdAt, 0);

test("append creates immutable sequential revisions and requires the expected revision", () => {
  const original = first();
  const next = appendPromptRevision(original, {
    id: "faithful-transcription", name: "Faithful transcription", scope: "recognition",
    text: "Preserve words and line breaks.",
  }, "2026-11-09T12:01:00Z", 1);
  assert.equal(original.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[0], original[0]);
  assert.equal(next[1].revision, 2);
  assert.throws(() => appendPromptRevision(original, {
    id: "faithful-transcription", name: "Faithful transcription", scope: "recognition", text: "Changed elsewhere.",
  }, createdAt, 0), /changed elsewhere/i);
  assert.throws(() => appendPromptRevision(original, {
    id: "faithful-transcription", name: "Faithful transcription", scope: "recognition", text: "Changed elsewhere.",
  }, createdAt), /expected prompt revision/i);
});

test("duplicate gets a new ID and preserves the source text exactly", () => {
  const source = first("cleanup", { text: "  Keep headings.\nNever rewrite quotations.  " });
  const duplicate = duplicatePromptRevision(source, { id: source[0].id, revision: 1 }, {
    id: "cleanup-copy", name: "Cleanup copy",
  }, "2026-11-09T12:02:00Z");
  assert.equal(duplicate.length, 2);
  assert.equal(duplicate[1].id, "cleanup-copy");
  assert.equal(duplicate[1].revision, 1);
  assert.equal(duplicate[1].scope, "cleanup");
  assert.equal(duplicate[1].text, source[0].text);
  assert.throws(() => duplicatePromptRevision(source, { id: source[0].id, revision: 1 }, {
    id: source[0].id, name: "Same ID",
  }, createdAt), /new, unique ID/i);
});

test("unbound legacy prompts remain unbound; explicit references resolve only to valid matching history", () => {
  const library = [...first(), ...first("cleanup", {
    id: "cleanup-default", name: "Cleanup default", text: "Fix punctuation only.",
  })];
  assert.equal(resolvePromptVersion(library, undefined, "recognition"), undefined);
  assert.equal(resolvePromptVersion(library, { id: "faithful-transcription", revision: 1 }, "recognition").text,
    "Preserve every word exactly.");
  assert.throws(() => resolvePromptVersion(library, { id: "faithful-transcription", revision: 1 }, "cleanup"), /unavailable/i);
  assert.throws(() => resolvePromptVersion(library, { id: "missing", revision: 1 }), /unavailable/i);
  assert.throws(() => resolvePromptVersion(library, /** @type {any} */ ({ id: "faithful-transcription", revision: 0 })), /reference is invalid/i);
});

test("library validation rejects gaps, duplicate revisions, invalid scopes and malformed references", () => {
  const library = first();
  assert.equal(validatePromptLibrary(library), true);
  assert.throws(() => validatePromptLibrary([{ ...library[0], revision: 2 }]), /incomplete/i);
  assert.throws(() => validatePromptLibrary([{ ...library[0], scope: "summary" }]), /invalid/i);
  assert.throws(() => validatePromptLibrary([{ ...library[0], text: "  " }]), /invalid/i);
  assert.throws(() => validatePromptLibrary("not a library"), /safely/i);
});

test("prompt entries cannot change category across revisions", () => {
  const library = first("recognition");
  assert.throws(() => appendPromptRevision(library, {
    id: library[0].id, name: library[0].name, scope: "cleanup", text: "Cleanup instead.",
  }, createdAt, 1), /cannot change/i);
});
