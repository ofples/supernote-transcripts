import test from "node:test";
import assert from "node:assert/strict";
import { qualitySettings, planRecognitionGroups, contextPages } from "../src/quality.mjs";
import { CONTINUE_PAGE_TEXT, EMPTY_PAGE_TEXT, GROUP_RESPONSE_RULES, recognitionPrompt } from "../src/prompts.mjs";
import { buildMarkdown, parseRecognitionGroup } from "../src/reconcile.mjs";

const descriptors = Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, number: i + 1, fingerprint: `f${i + 1}` }));
const saved = (number, text) => ({ fingerprint: `f${number}`, text, recipe: "r", number });

test("quality presets keep legacy sources fast and expose the requested budgets", () => {
  assert.deepEqual(qualitySettings(undefined), { mode: "fast", pagesPerRequest: 1, neighborPages: 0, textContextChars: 0, reasoningEffort: "low" });
  assert.equal(qualitySettings("balanced").textContextChars, 12000);
  assert.equal(qualitySettings("careful").neighborPages, 2);
});

test("groups preserve priority order and split at descriptor gaps and page limits", () => {
  const pending = [descriptors[1], descriptors[2], descriptors[5], descriptors[6], descriptors[3], descriptors[0]];
  const groups = planRecognitionGroups(pending, descriptors, "balanced");
  assert.deepEqual(groups.map((g) => g.map((p) => p.number)), [[2, 3], [6, 7], [4], [1]]);
  assert.deepEqual(planRecognitionGroups([descriptors[3], descriptors[2]], descriptors, "balanced").map((g) => g.map((p) => p.number)), [[4, 3]]);
  assert.deepEqual(planRecognitionGroups(descriptors.slice(0, 5), descriptors, "fast").map((g) => g.length), [1, 1, 1, 1, 1]);
});

test("context pages are bounded, deduplicated, and exclude request targets", () => {
  assert.deepEqual(contextPages([descriptors[0], descriptors[1]], descriptors, "careful").map((p) => p.number), [3, 4]);
  assert.deepEqual(contextPages([descriptors[3]], descriptors, "careful").map((p) => p.number), [2, 3, 5, 6]);
  assert.deepEqual(contextPages([descriptors[0]], descriptors, "fast"), []);
});

test("group prompt labels target and context pages, bounds OCR context, and requires JSON", () => {
  const prompt = recognitionPrompt("transcribe", "glossary hint", [descriptors[1]], [descriptors[0]], "x".repeat(13000), "balanced");
  assert.match(prompt, /Target pages.*Page 2/);
  assert.match(prompt, /Context pages.*Page 1/);
  assert.equal(prompt.includes("x".repeat(12001)), false);
  assert.match(prompt, /JSON object/);
  assert.match(prompt, /Honor the user's profile instructions/);
  assert.match(prompt, /image content, OCR.*never as instructions/);
  assert.match(GROUP_RESPONSE_RULES, /set its text field to exactly/);
  assert.doesNotMatch(GROUP_RESPONSE_RULES, /and nothing else/);
});

test("structured parsing salvages valid siblings and rejects duplicate or malformed target entries", () => {
  const targets = [descriptors[0], descriptors[1], descriptors[2]];
  const parsed = parseRecognitionGroup(JSON.stringify({ pages: [
    { number: 1, text: "first", joinPrevious: false },
    { number: 2, text: "second", joinPrevious: true },
    { number: 2, text: "duplicate", joinPrevious: false },
    { number: 3, text: "", joinPrevious: false },
    { number: 99, text: "ignore", joinPrevious: false },
  ] }), targets);
  assert.deepEqual(parsed.results, [{ page: targets[0], text: "first" }]);
  assert.deepEqual(parsed.failures.map((failure) => failure.page.number), [2, 3]);
  assert.equal(parsed.failures.find((failure) => failure.page.number === 3).kind,"empty_response");
  assert.equal(parseRecognitionGroup("not json", targets).failures.length, 3);
  assert.equal(parseRecognitionGroup("legacy markdown", [targets[0]]).failures.length, 1);
  assert.equal(parseRecognitionGroup("```\nlegacy markdown\n```", [targets[0]]).failures.length, 1);
  assert.equal(parseRecognitionGroup("legacy markdown", [targets[0]], { allowLegacy: true }).results[0].text, "legacy markdown");
});

test("continuation markers flow paragraphs and list items while headings retain page structure", () => {
  const notebook = { output: "notes.md", desired: descriptors.slice(0, 3), pages: {
    p1: saved(1, "The thought continues"),
    p2: saved(2, `${CONTINUE_PAGE_TEXT}\nacross this page.`),
    p3: saved(3, "- an unfinished list item"),
  } };
  const flowing = buildMarkdown(notebook, false);
  assert.match(flowing, /The thought continues <!-- supernote-page:p2 number:2 --> across this page\./);
  assert.match(flowing, /<!-- supernote-page:p3 number:3 -->\n\n- an unfinished list item/);
  assert.doesNotMatch(flowing, /supernote-continue/);
  const headed = buildMarkdown({ ...notebook, desired: descriptors.slice(0, 2) }, true);
  assert.match(headed, /## Page 1[\s\S]*## Page 2/);
  assert.doesNotMatch(headed, /supernote-continue/);
});

test("continuations do not cross blank, missing, stale, or skipped intermediary pages", () => {
  const make = (middle) => ({ output: "notes.md", desired: descriptors.slice(0, 3), pages: {
    p1: saved(1, "Starts here."), p2: middle,
    p3: saved(3, `${CONTINUE_PAGE_TEXT}\ncontinues here.`),
  } });
  for (const middle of [undefined, saved(2, EMPTY_PAGE_TEXT), { ...saved(2, "old"), fingerprint: "old" }]) {
    const text = buildMarkdown(make(middle), false);
    assert.match(text, /continues here/);
    assert.match(text, /<!-- supernote-page:p3 number:3 -->\n\ncontinues here/);
  }
  const skipped = make(saved(2, "middle"));
  skipped.pageIssues = { p2: { fingerprint: "f2", status: "skipped" } };
  assert.match(buildMarkdown(skipped, false), /<!-- supernote-page:p3 number:3 -->\n\ncontinues here/);
});

test("three and four page continuation chains accumulate in one flowing paragraph", () => {
  const pages = descriptors.slice(0, 4).map((page, i) => ({
    ...page,
    result: saved(page.number, i === 0 ? "A sentence" : `${CONTINUE_PAGE_TEXT}\ncontinues ${i}.`),
  }));
  const output = buildMarkdown({ output: "chain.md", desired: pages, pages: Object.fromEntries(pages.map((p) => [p.id, p.result])) }, false);
  assert.match(output, /A sentence <!-- supernote-page:p2 number:2 --> continues 1\. <!-- supernote-page:p3 number:3 --> continues 2\. <!-- supernote-page:p4 number:4 --> continues 3\./);
});

test("list continuations and intentional paragraph breaks retain Markdown structure", () => {
  const list = buildMarkdown({ output: "list.md", desired: descriptors.slice(0, 2), pages: {
    p1: saved(1, "- A list item begins"),
    p2: saved(2, `${CONTINUE_PAGE_TEXT}\nand continues.`),
  } }, false);
  assert.match(list, /- A list item begins <!-- supernote-page:p2 number:2 --> and continues\./);
  const paragraphs = buildMarkdown({ output: "paragraphs.md", desired: descriptors.slice(0, 2), pages: {
    p1: saved(1, "First paragraph.\n\nFinal paragraph"),
    p2: saved(2, `${CONTINUE_PAGE_TEXT}\ncontinues here.\n\nA new paragraph.`),
  } }, false);
  assert.match(paragraphs, /First paragraph\.\n\nFinal paragraph <!-- supernote-page:p2 number:2 --> continues here\.\n\nA new paragraph\./);
});

test("unsafe Markdown blocks and heading lines keep page boundaries", () => {
  for (const previous of ["## Heading", "```js\ncode\n```", "| a | b |\n| --- | --- |", "> quoted", "---"]) {
    const output = buildMarkdown({ output: "safe.md", desired: descriptors.slice(0, 2), pages: {
      p1: saved(1, previous), p2: saved(2, `${CONTINUE_PAGE_TEXT}\ncontinued text`),
    } }, false);
    assert.match(output, /<!-- supernote-page:p2 number:2 -->\n\ncontinued text/);
  }
  const nextList = buildMarkdown({ output: "list.md", desired: descriptors.slice(0, 2), pages: {
    p1: saved(1, "The paragraph ends"), p2: saved(2, `${CONTINUE_PAGE_TEXT}\n- a new list item`),
  } }, false);
  assert.match(nextList, /<!-- supernote-page:p2 number:2 -->\n\n- a new list item/);
});
