import { parsePageMarkers } from "./page-links.mjs";

const START = /^<!--[ \t]*supernote-manual:start:([A-Za-z0-9_-]{1,80})(?::name:([^ \t]+))?[ \t]*-->[ \t]*$/;
const END = /^<!--[ \t]*supernote-manual:end:([A-Za-z0-9_-]{1,80})[ \t]*-->[ \t]*$/;

/** Parse standalone manual section markers; old unnamed IDs remain valid. */
export function parseManualSections(text) {
  if (typeof text !== "string") return [];
  const sections = [];
  let offset = 0, open;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const content = line.replace(/\r?\n$/, ""), start = START.exec(content), end = END.exec(content);
    if (start && !open) {
      let name = "";
      if (start[2]) { try { name = decodeURIComponent(start[2]); } catch { name = ""; } }
      open = { id: start[1], name, from: offset };
    } else if (end && open?.id === end[1]) {
      sections.push({ ...open, to: offset + line.length }); open = undefined;
    }
    offset += line.length;
  }
  return sections;
}

export function encodeManualSectionName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed ? `:name:${encodeURIComponent(trimmed)}` : "";
}

/** Gate editor actions to a known mirror output that still has managed frontmatter. */
export function managedTranscriptTarget(path, text, notebooks, isManagedTranscript) {
  return typeof path === "string" && typeof isManagedTranscript === "function" && isManagedTranscript(text) &&
    Object.values(notebooks ?? {}).some(state => state &&
      (state.output === path || state.outputOverride === path));
}

/** A section must be inserted inside one page body, outside frontmatter and page anchors. */
export function manualSectionPlacementAllowed(path, text, notebooks, isManagedTranscript, from, to = from) {
  if (!managedTranscriptTarget(path, text, notebooks, isManagedTranscript) ||
      !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > text.length) return false;
  const frontmatter = /^---\r?\n[\s\S]{0,8192}?\r?\n---(?:\r?\n|$)/.exec(text);
  if (frontmatter && from < frontmatter[0].length) return false;
  const boundaries = parsePageMarkers(text).map(marker => ({ from: marker.from, to: marker.to }));
  if (!boundaries.length) for (const match of text.matchAll(/^## Page \d+[ \t]*\r?\n?/gm))
    boundaries.push({ from: match.index, to: match.index + match[0].length });
  if (!boundaries.length) return false;
  if (boundaries.some(anchor => from < anchor.to && to > anchor.from || (from >= anchor.from && from < anchor.to))) return false;
  return boundaries.some(anchor => anchor.to <= from) && !boundaries.some(anchor => anchor.from > from && anchor.from < to);
}
