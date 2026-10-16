import test from "node:test";
import assert from "node:assert/strict";
import {
  pagesFromRange,
  outputPath,
  documentText,
  responseText,
} from "../src/core.mjs";
test("only valid bounded pages are selected", () => {
  assert.deepEqual(pagesFromRange("2-4", 5), [2, 3, 4]);
  for (const s of ["0", "4-2", "1-6", "all"])
    assert.throws(() => pagesFromRange(s, 5));
  assert.throws(() => pagesFromRange("1-11", 20));
});
test("output cannot escape vault or overwrite hidden configuration", () => {
  assert.equal(
    outputPath("Experiments/Transcripts", "nested/a.note"),
    "Experiments/Transcripts/nested/a.md",
  );
  for (const folder of ["../Note", "/Note", ".obsidian", "Experiments/../Note"])
    assert.throws(() => outputPath(folder, "a.note"));
});
test("merged page output retains old pages in numerical order", () => {
  const text = documentText("a", { 10: { text: "ten" }, 2: { text: "two" } });
  assert.ok(text.indexOf("Page 2") < text.indexOf("Page 10"));
  assert.ok(text.startsWith("---\nnomad_transcripts: true"));
});
test("incomplete and empty responses are not accepted", () => {
  assert.throws(() => responseText({ status: "incomplete", output: [] }));
  assert.equal(
    responseText({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Recognized" }],
        },
      ],
    }),
    "Recognized",
  );
});
