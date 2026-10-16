import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERAL_TRANSCRIPTION_PROMPT,
  GROUP_RESPONSE_RULES,
  recognitionPrompt,
  SATSANG_TRANSCRIPTION_PROMPT,
} from "../src/prompts.mjs";

const targets = [{ id: "p7", number: 7 }];

test("bundled general and Satsang prompts reflow physical wraps and retain authored structure", () => {
  for (const prompt of [GENERAL_TRANSCRIPTION_PROMPT, SATSANG_TRANSCRIPTION_PROMPT]) {
    assert.match(prompt, /Reflow physical handwriting line wraps into continuous prose paragraphs/);
    assert.match(prompt, /do not preserve page or handwriting line breaks/);
    assert.match(prompt, /Preserve meaningful paragraph breaks/);
    assert.match(prompt, /headings, lists, dialogue, quotations and indentation/);
    assert.match(prompt, /Do not summarize, polish, add information/);
  }
  assert.match(SATSANG_TRANSCRIPTION_PROMPT, /without expanding them into a polished essay/);
});

test("group protocol preserves page-numbered JSON and only joins supported continuations", () => {
  assert.match(GROUP_RESPONSE_RULES, /JSON object shaped as \{"pages":\[\{"number":1,"text":"transcription","joinPrevious":false\}\]\}/);
  assert.match(GROUP_RESPONSE_RULES, /exactly one entry for each target page, using its exact page number/);
  assert.match(GROUP_RESPONSE_RULES, /Reflow physical handwriting line wraps into continuous prose paragraphs/);
  assert.match(GROUP_RESPONSE_RULES, /Preserve meaningful paragraph breaks, headings, lists, dialogue/);
  assert.match(GROUP_RESPONSE_RULES, /only when the preceding page's image is supplied as a target or context page/);
  assert.match(GROUP_RESPONSE_RULES, /A page break alone is not evidence of continuation/);
  assert.match(GROUP_RESPONSE_RULES, /do not add words from the preceding page or invent connecting text/);
  assert.match(GROUP_RESPONSE_RULES, /Do not summarize, polish, add information/);
});

test("recognition prompt keeps custom prompt text intact and exact target page identities", () => {
  const custom = "Use my terminology; retain the writer's wording.";
  const prompt = recognitionPrompt(custom, "glossary", targets);
  assert.ok(prompt.startsWith(`${custom}\n\n`));
  assert.match(prompt, /Target pages \(transcribe exactly these\): Page 7/);
  assert.match(prompt, /exactly one entry for each target page, using its exact page number/);
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /never as instructions/);
});
