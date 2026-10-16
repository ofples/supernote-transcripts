import assert from "node:assert/strict";
import { buildMarkdown } from "../src/reconcile.mjs";
import { EMPTY_PAGE_TEXT } from "../src/prompts.mjs";

// Pure mock fixture: no Obsidian vault, provider, credentials, or source files.
// It checks that explicit blank markers become empty pages, while failed and
// skipped pages remain visibly distinct in the generated Markdown.
const notebook = {
  output: "Supernote Transcripts/Fixture.md",
  desired: [
    { id: "blank", number: 1, fingerprint: "f1" },
    { id: "failed", number: 2, fingerprint: "f2" },
    { id: "skipped", number: 3, fingerprint: "f3" },
  ],
  pages: {
    blank: { fingerprint: "f1", number: 1, text: EMPTY_PAGE_TEXT, recipe: "fixture" },
  },
  pageIssues: {
    failed: { fingerprint: "f2", number: 2, status: "failed", kind: "empty_response", reason: "No transcription text was returned." },
    skipped: { fingerprint: "f3", number: 3, status: "skipped", kind: "empty_response", reason: "Skipped by user." },
  },
};

for (const platform of ["nomad", "desktop"]) {
  const markdown = buildMarkdown(notebook, true);
  assert.match(markdown, /## Page 1\n\n\n\n## Page 2/);
  assert.doesNotMatch(markdown, /supernote-empty-page/);
  assert.match(markdown, /This page could not be recognized\. Retry it explicitly or skip it in Supernote Transcripts\./);
  assert.match(markdown, /Page skipped by you; no transcription is claimed\./);
  assert.equal((markdown.match(/## Page \d/g) ?? []).length, 3);
  console.log(`${platform}: blank, failed, and skipped page output verified`);
}
