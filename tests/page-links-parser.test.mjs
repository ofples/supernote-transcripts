import test from "node:test";
import assert from "node:assert/strict";
import { boundedSectionText, pageMarkerGroups, parsePageLinkToken, parsePageMarkers } from "../src/page-links.mjs";

test("parses stable page ids, positions, numbers, and source lines", () => {
  const source = "intro\nSentence <!-- supernote-page:native%3A12%20x number:12 --> continues";
  const [marker] = parsePageMarkers(source);
  assert.deepEqual(marker, {
    from: source.indexOf("<!--"),
    to: source.length - " continues".length,
    pageId: "native:12 x",
    number: 12,
    line: 1,
  });
});

test("ignores marker-like text inside fenced and inline code", () => {
  const source = [
    "`<!-- supernote-page:inline number:2 -->`",
    "~~~md",
    "<!-- supernote-page:fenced number:3 -->",
    "~~~",
    "<!-- supernote-page:visible number:4 -->",
  ].join("\n");
  assert.deepEqual(parsePageMarkers(source).map(marker => marker.pageId), ["visible"]);
  assert.deepEqual(parsePageMarkers("``code span\n<!-- supernote-page:multiline number:1 -->\nend``"), []);
});

test("treats an unmatched backtick as literal and keeps later page markers visible", () => {
  const source = "An unmatched ` character. <!-- supernote-page:after-literal number:6 -->";
  assert.deepEqual(parsePageMarkers(source).map(marker => [marker.pageId, marker.number]), [["after-literal", 6]]);
});

test("rejects malformed encodings, unsafe ids, and unreasonable page numbers", () => {
  const source = [
    "<!-- supernote-page:%E0%A4%A number:1 -->",
    "<!-- supernote-page:bad%0Aid number:2 -->",
    "<!-- supernote-page:huge number:999999999999999999999999 -->",
    "<!-- supernote-page:zero number:0 -->",
    "<!-- supernote-page:good number:8 -->",
  ].join("\n");
  assert.deepEqual(parsePageMarkers(source).map(marker => [marker.pageId, marker.number]), [["good", 8]]);
});

test("does not parse unrelated or incomplete comments", () => {
  assert.deepEqual(parsePageMarkers("<!-- supernote-empty-page -->\n<!-- supernote-page:x -->\nordinary text"), []);
  assert.deepEqual(parsePageMarkers("<!-- supernote-page:x\nnumber:1 -->"), []);
});

test("bounds whole-file section text to its reported line span", () => {
  assert.equal(boundedSectionText("a\nb\nc\nd\ne", 2, 3), "c\nd");
  assert.equal(boundedSectionText("c\nd", 2, 3), "c\nd");
  assert.equal(boundedSectionText("a\nb", 0, 1), "a\nb");
});

test("groups standalone and consecutive markers with the following block without consuming its text", () => {
  const source = [
    "---", "nomad_transcripts: true", "---", "",
    "Before paragraph.", "", "<!-- supernote-page:native%3Aa number:2 -->", "",
    "<!-- supernote-page:native%3Ab number:3 -->", "", "## Heading", "",
    "- item", "", "<!-- supernote-page:native%3Ac number:4 -->", "",
  ].join("\n");
  const markers = parsePageMarkers(source);
  const groups = pageMarkerGroups(source, markers);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.markers.map(marker => marker.number)), [[2, 3], [4]]);
  assert.equal(source.split("\n")[groups[0].targetLine], "## Heading");
  assert.equal(groups[1].eof, true);
  assert.equal(source.slice(groups[1].from, groups[1].to).startsWith("\n"), true);
});

test("marker-only transcripts keep links in the body instead of attaching to YAML frontmatter", () => {
  const source = "---\nnomad_transcripts: true\n---\n\n<!-- supernote-page:a number:1 -->\n\n<!-- supernote-page:b number:2 -->\n";
  const [group] = pageMarkerGroups(source);
  assert.equal(group.targetLine, null);
  assert.equal(group.eof, true);
  assert.deepEqual(group.markers.map(marker => marker.number), [1, 2]);
  assert.equal(source.slice(group.from, group.to).includes("nomad_transcripts"), false);
});

test("extracts only generated page-link tokens from hierarchical and opaque Obsidian URIs", () => {
  assert.equal(parsePageLinkToken("obsidian://nomad-transcripts-page-link?token=41-12-3"), "41-12-3");
  assert.equal(parsePageLinkToken("obsidian:nomad-transcripts-page-link?token=41-12-3"), "41-12-3");
  assert.equal(parsePageLinkToken("obsidian://nomad-transcripts-page-link?token=%34%31-12-3"), "41-12-3");
});

test("rejects other routes, extra query parameters, malformed encodings, and unsafe tokens", () => {
  for (const href of [
    "https://nomad-transcripts-page-link?token=41-12-3",
    "obsidian://other-route?token=41-12-3",
    "obsidian:/nomad-transcripts-page-link?token=41-12-3",
    "obsidian://nomad-transcripts-page-link?token=41-12-3&extra=1",
    "obsidian://nomad-transcripts-page-link?token=%ZZ",
    "obsidian://nomad-transcripts-page-link?token=41-0-3",
    "obsidian://nomad-transcripts-page-link?token=20000001-12-3",
    "obsidian://nomad-transcripts-page-link?token=41-100001-3",
  ]) assert.equal(parsePageLinkToken(href), null, href);
});
