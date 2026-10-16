const MARKER = /<!--[ \t]*supernote-page:([^\s]+)[ \t]+number:(\d+)[ \t]*-->/g;
const PAGE_LINK_PREFIXES = [
  "obsidian://nomad-transcripts-page-link?token=",
  "obsidian:nomad-transcripts-page-link?token=",
];

function codeRanges(source) {
  const ranges = [];
  let offset = 0;
  let fence = null;
  for (const line of source.split(/\n/)) {
    const lineEnd = offset + line.length;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length &&
          (fence.char === "~" || line.slice(fenceMatch[0].length).trim() === "")) {
        ranges.push([offset, lineEnd + (lineEnd < source.length ? 1 : 0)]);
        fence = null;
      } else {
        ranges.push([offset, lineEnd + (lineEnd < source.length ? 1 : 0)]);
      }
    } else if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      ranges.push([offset, lineEnd + (lineEnd < source.length ? 1 : 0)]);
    }
    offset = lineEnd + 1;
  }
  if (fence) ranges.push([offset, source.length]);

  let openTicks = 0, openAt = -1;
  const fences = ranges.slice();
  let fenceIndex = 0;
  for (let i = 0; i < source.length;) {
    while (fenceIndex < fences.length && fences[fenceIndex][1] <= i) fenceIndex++;
    const fenceRange = fences[fenceIndex];
    if (fenceRange && i >= fenceRange[0] && i < fenceRange[1]) { i = fenceRange[1]; continue; }
    if (source[i] !== "`") { i++; continue; }
    let j = i + 1;
    while (source[j] === "`") j++;
    const count = j - i;
    if (!openTicks) { openTicks = count; openAt = i; }
    else if (count === openTicks) {
      ranges.push([openAt, j]);
      openTicks = 0;
      openAt = -1;
    }
    i = j;
  }
  // An unmatched backtick run is literal Markdown. Only a matching run closes
  // an inline code span, so it must not hide later page markers.
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** Parse generated page comments without treating code examples as navigation. */
export function parsePageMarkers(source) {
  if (typeof source !== "string" || source.length > 20_000_000) return [];
  const ignored = codeRanges(source);
  const markers = [];
  MARKER.lastIndex = 0;
  let ignoredIndex = 0, scannedTo = 0, line = 0;
  for (let match; (match = MARKER.exec(source));) {
    const from = match.index;
    const to = from + match[0].length;
    while (ignoredIndex < ignored.length && ignored[ignoredIndex][1] <= from) ignoredIndex++;
    const ignoredRange = ignored[ignoredIndex];
    while (scannedTo < from) {
      if (source.charCodeAt(scannedTo) === 10) line++;
      scannedTo++;
    }
    if (ignoredRange && from >= ignoredRange[0] && to <= ignoredRange[1]) continue;
    let pageId;
    try { pageId = decodeURIComponent(match[1]); } catch { continue; }
    const number = Number(match[2]);
    if (!pageId || pageId.length > 256 || /[\u0000-\u001f\u007f]/.test(pageId) ||
        !Number.isSafeInteger(number) || number < 1 || number > 100_000) continue;
    markers.push({ from, to, pageId, number, line });
  }
  return markers;
}

/** Group marker-only lines with their next content line, or previous line at EOF. */
export function pageMarkerGroups(source, markers = parsePageMarkers(source)) {
  if (typeof source !== "string" || !Array.isArray(markers) || !markers.length) return [];
  const lines = [];
  let start = 0;
  for (const text of source.split(/\r?\n/)) {
    const end = start + text.length;
    lines.push({ start, end, after: end < source.length ? end + (source[end] === "\r" ? 2 : 1) : end, text });
    start = end + (source[end] === "\r" ? 2 : 1);
  }
  const lineMarkers = new Map();
  for (const marker of markers) {
    const line = lines[marker.line];
    if (!line || source.slice(line.start, marker.from).trim() || source.slice(marker.to, line.end).trim()) continue;
    const list = lineMarkers.get(marker.line) ?? [];
    list.push(marker);
    lineMarkers.set(marker.line, list);
  }
  const groups = [];
  const used = new Set();
  const sourceLines = source.split(/\r?\n/);
  const hasFrontmatter = sourceLines[0]?.trim() === "---";
  const frontmatterEnd = hasFrontmatter ? sourceLines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  const bodyStartLine = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
  for (const [firstLine, firstMarkers] of lineMarkers) {
    if (used.has(firstLine)) continue;
    let lastLine = firstLine;
    const groupMarkers = [...firstMarkers];
    used.add(firstLine);
    while (lastLine + 1 < lines.length) {
      let next = lastLine + 1;
      while (next < lines.length && !lines[next].text.trim()) next++;
      if (next >= lines.length || !lineMarkers.has(next)) break;
      for (let blank = lastLine + 1; blank < next; blank++) used.add(blank);
      lastLine = next;
      used.add(lastLine);
      groupMarkers.push(...lineMarkers.get(lastLine));
    }
    let targetLine = lastLine + 1;
    while (targetLine < lines.length && !lines[targetLine].text.trim()) targetLine++;
    const eof = targetLine >= lines.length;
    let from, to, target;
    if (eof) {
      let previousLine = firstLine - 1;
      while (previousLine >= bodyStartLine && !lines[previousLine].text.trim()) previousLine--;
      if (previousLine < bodyStartLine) { from = lines[firstLine].start; to = lines[lastLine].after; target = null; }
      else { from = lines[previousLine].end; to = lines[lastLine].after; target = previousLine; }
    } else {
      from = lines[firstLine].start;
      to = lines[targetLine].start;
      target = targetLine;
    }
    groups.push({ from, to, targetLine: target, eof, markerLines: Array.from({ length: lastLine - firstLine + 1 }, (_, i) => firstLine + i), markers: groupMarkers });
  }
  return groups.sort((a, b) => a.from - b.from);
}

/** Live Preview tables are block widgets. Keep their boundary chip on preceding
 * prose rather than introducing an otherwise empty editor line above the table. */
export function pageMarkerTableAnchor(source, group, groups = pageMarkerGroups(source)) {
  if (group.eof || group.targetLine === null) return null;
  const lines = source.split(/\r?\n/);
  const heading = lines[group.targetLine] ?? "";
  const separator = lines[group.targetLine + 1] ?? "";
  if (!heading.includes("|") || !separator.includes("|") ||
      !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(separator)) return null;
  const headerEnd = lines[0]?.trim() === "---" ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  const bodyStart = headerEnd >= 0 ? headerEnd + 1 : 0;
  const metadataLines = new Set(groups.flatMap(item => item.markerLines));
  const ignored = codeRanges(source);
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + (source[offset + line.length] === "\r" ? 2 : 1);
  }
  for (let line = group.markerLines[0] - 1; line >= bodyStart; line--) {
    const value = lines[line];
    if (!value.trim() || metadataLines.has(line) || /^\s*<!--/.test(value)) continue;
    if (value.includes("|") || /^\s*(?:[-*_][ \t]*){3,}$/.test(value)) return null;
    const after = starts[line] + value.length + (source[starts[line] + value.length] === "\r" ? 2 : 1);
    if (ignored.some(([from, to]) => from <= starts[line] && to >= after)) return null;
    return starts[line] + value.length;
  }
  return null;
}

/** Extract only tokens from the generated page-link URI, including Android's opaque-scheme form. */
export function parsePageLinkToken(href) {
  if (typeof href !== "string" || href.length > 512) return null;
  const prefix = PAGE_LINK_PREFIXES.find(value => href.startsWith(value));
  if (!prefix) return null;
  let token;
  try { token = decodeURIComponent(href.slice(prefix.length)); } catch { return null; }
  if (!/^(?:0|[1-9]\d{0,7})-(?:[1-9]\d{0,5})-(?:0|[1-9]\d{0,5})$/.test(token)) return null;
  const [position, number, index] = token.split("-").map(Number);
  if (position > 20_000_000 || number > 100_000 || index > 400_000) return null;
  return token;
}

/** Obsidian versions differ: section.text may be the section or the whole file. */
export function boundedSectionText(text, lineStart, lineEnd) {
  if (typeof text !== "string" || !Number.isInteger(lineStart) || !Number.isInteger(lineEnd) ||
      lineStart < 0 || lineEnd < lineStart) return "";
  const lines = text.split(/\r?\n/);
  const expected = lineEnd - lineStart + 1;
  if (lineStart === 0 && lines.length <= expected + 1) return text;
  if (lines.length > expected + 1) return lines.slice(lineStart, lineEnd + 1).join("\n");
  return text;
}
