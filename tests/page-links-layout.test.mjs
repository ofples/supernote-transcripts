import test from "node:test";
import assert from "node:assert/strict";
import { pageMarkerGroups, pageMarkerTableAnchor } from "../src/page-links.mjs";

test("Live Preview table boundary uses preceding prose without hiding table source", () => {
  const source = "---\nnomad_transcripts: true\n---\n\n# Notebook\n\nPrevious paragraph.\n\n<!-- supernote-page:p2 number:2 -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
  const [group] = pageMarkerGroups(source);
  const anchor = pageMarkerTableAnchor(source, group);
  assert.equal(anchor, source.indexOf("Previous paragraph.") + "Previous paragraph.".length);
  assert.equal(source.slice(group.from, group.to).includes("|"), false);
  assert.ok(group.to <= source.indexOf("| A |"));
});

test("first-page tables can use the notebook title; never YAML or an earlier content block", () => {
  const table = "<!-- supernote-page:p1 number:1 -->\n\n| A |\n| --- |\n| 1 |";
  const prefix = "---\nnomad_transcripts: true\n---\n\n";
  const titled = prefix + "# Notebook\n\n" + table;
  assert.equal(pageMarkerTableAnchor(titled, pageMarkerGroups(titled)[0]), titled.indexOf("# Notebook") + "# Notebook".length);
  const bare = prefix + table;
  assert.equal(pageMarkerTableAnchor(bare, pageMarkerGroups(bare)[0]), null);
  const code = prefix + "# Notebook\n\n```\ncode\n```\n\n" + table;
  assert.equal(pageMarkerTableAnchor(code, pageMarkerGroups(code)[0]), null);
  const prose = prefix + "`jnana` in prose.\n\n" + table;
  assert.equal(pageMarkerTableAnchor(prose, pageMarkerGroups(prose)[0]), prose.indexOf("`jnana` in prose.") + "`jnana` in prose.".length);
});

test("ordinary pipe text and EOF markers are not treated as rendered table boundaries", () => {
  const ordinary = "Text.\n\n<!-- supernote-page:p2 number:2 -->\n\nA | B\nAnother sentence.";
  assert.equal(pageMarkerTableAnchor(ordinary, pageMarkerGroups(ordinary)[0]), null);
  const eof = "Text.\n\n<!-- supernote-page:p2 number:2 -->";
  assert.equal(pageMarkerTableAnchor(eof, pageMarkerGroups(eof)[0]), null);
});
