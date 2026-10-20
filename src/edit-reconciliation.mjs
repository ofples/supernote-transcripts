const MAX_MARKDOWN = 20_000_000;
const MAX_DIFF_CELLS = 250_000;
const MAX_PAGES = 20_000;

function codeRanges(source) {
  const ranges = [];
  let offset = 0, fence = null;
  for (const line of source.split(/\n/)) {
    const end = offset + line.length;
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      ranges.push([offset, Math.min(source.length, end + (end < source.length ? 1 : 0))]);
      if (m && m[1][0] === fence.char && m[1].length >= fence.length &&
          (fence.char === "~" || line.slice(m[0].length).trim() === "")) fence = null;
    } else if (m) {
      fence = { char: m[1][0], length: m[1].length };
      ranges.push([offset, Math.min(source.length, end + (end < source.length ? 1 : 0))]);
    }
    offset = end + 1;
  }
  if (fence) ranges.push([offset, source.length]);
  // Inline code spans: matching backtick runs only. Unmatched runs are literal.
  let run = 0, start = -1;
  const fenced = ranges.slice(); let fi = 0;
  for (let i = 0; i < source.length;) {
    while (fi < fenced.length && fenced[fi][1] <= i) fi++;
    if (fenced[fi] && i >= fenced[fi][0] && i < fenced[fi][1]) { i = fenced[fi][1]; continue; }
    if (source[i] !== "`") { i++; continue; }
    let j = i + 1; while (source[j] === "`") j++;
    if (!run) { run = j - i; start = i; }
    else if (run === j - i) { ranges.push([start, j]); run = 0; start = -1; }
    i = j;
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function anchors(source, pages) {
  if (typeof source !== "string" || source.length > MAX_MARKDOWN) return { error: "Markdown is missing or exceeds the safe size limit." };
  const ignored = codeRanges(source), result = [];
  const inside = (at) => {
    let lo = 0, hi = ignored.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (ignored[mid][0] <= at) lo = mid + 1; else hi = mid; }
    return lo > 0 && at < ignored[lo - 1][1];
  };
  const markerStarts = new Set();
  const marker = /<!--[ \t]*supernote-page:([^\s]+)[ \t]+number:([^\s]+)[ \t]*-->/g;
  for (let m; (m = marker.exec(source));) {
    if (inside(m.index)) continue;
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return { error: "A page marker has an invalid encoded ID." }; }
    const number = Number(m[2]);
    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id) || !Number.isSafeInteger(number) || number < 1 || number > 100_000)
      return { error: "A page marker is malformed." };
    markerStarts.add(m.index);
    result.push({ from: m.index, to: marker.lastIndex, id, number, kind: "marker" });
  }
  // Reject marker-like comments that did not match the complete supported grammar.
  const mentions = /<!--[ \t]*supernote-page:/g;
  for (let m; (m = mentions.exec(source));) if (!inside(m.index) && !markerStarts.has(m.index))
    return { error: "A malformed page marker makes the page boundaries unsafe." };
  const heading = /^## Page ([^\r\n]+)[ \t]*$/gm;
  for (let m; (m = heading.exec(source));) {
    if (inside(m.index)) continue;
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100_000) return { error: "A legacy page heading is malformed." };
    const lineEnd = source.indexOf("\n", m.index + m[0].length);
    result.push({ from: m.index, to: lineEnd < 0 ? source.length : lineEnd + 1, number: n, kind: "heading" });
  }
  result.sort((a, b) => a.from - b.from);
  if (result.some((a, i) => i && a.from < result[i - 1].to)) return { error: "Page markers overlap." };
  if (result.some(a => a.kind !== result[0]?.kind)) return { error: "The document mixes page marker formats." };
  return { anchors: result };
}

function pageRows(pages) {
  const rows = Array.isArray(pages) ? pages : Object.entries(pages ?? {}).map(([id, p]) => ({ id, ...p }));
  if (!rows.length || rows.length > MAX_PAGES) return null;
  const normalized = rows.map((p, i) => ({ id: p?.id, number: p?.number ?? i + 1 }));
  if (normalized.some(p => typeof p.id !== "string" || !p.id || !Number.isSafeInteger(p.number) || p.number < 1) ||
      new Set(normalized.map(p => p.id)).size !== normalized.length || new Set(normalized.map(p => p.number)).size !== normalized.length) return null;
  return normalized;
}

function splitDocument(source, pages) {
  const parsed = anchors(source, pages);
  if (parsed.error) return parsed;
  const rows = pageRows(pages), list = parsed.anchors;
  if (!rows || !list.length) return { error: "The page map or document boundaries are missing." };
  const kinds = new Set(list.map(a => a.kind));
  if (kinds.size !== 1) return { error: "The document mixes page marker formats." };
  const byId = new Map(rows.map(p => [p.id, p]));
  const byNumber = new Map(rows.map(p => [p.number, p]));
  const mapped = list.map(a => {
    const page = a.kind === "marker" ? byId.get(a.id) : byNumber.get(a.number);
    if (!page || page.number !== a.number && a.kind === "marker") return null;
    return { ...a, id: page.id };
  });
  if (mapped.some(x => !x)) return { error: "A page boundary is unknown to the baseline map." };
  if (mapped.length !== rows.length || mapped.some((a, i) => a.id !== rows[i].id))
    return { error: "Page boundaries are missing, duplicated, added, removed, or reordered." };
  const prefix = source.slice(0, mapped[0].from);
  const segments = mapped.map((a, i) => ({ id: a.id, text: source.slice(a.to, mapped[i + 1]?.from ?? source.length) }));
  return { prefix, segments };
}

/** Capture edits to generated pages while requiring stable document/page structure. */
export function captureMarkdownEdits(baseMarkdown, currentMarkdown, pages) {
  const base = splitDocument(baseMarkdown, pages), current = splitDocument(currentMarkdown, pages);
  if (base.error || current.error) return { status: "conflict", reason: base.error ? `Baseline: ${base.error}` : `Current document: ${current.error}` };
  if (base.prefix !== current.prefix) return { status: "conflict", reason: "Frontmatter or document heading changed; page boundaries cannot be reconciled safely." };
  const edits = base.segments.map((s, i) => ({ id: s.id, baseText: s.text, editedText: current.segments[i].text }));
  return { status: edits.some(p => p.baseText !== p.editedText) ? "edited" : "clean", pages: edits };
}

function lines(text) { return text.match(/[^\n]*\n|[^\n]+$/g) ?? []; }
function diffHunks(base, changed) {
  const a = lines(base), b = lines(changed);
  if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) return null;
  const width = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  const hunks = []; let i = 0, j = 0, start = null, replacement = [];
  const flush = () => { if (start !== null) hunks.push({ start, end: i, replacement: replacement.join("") }); start = null; replacement = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
    else {
      if (start === null) start = i;
      if (j < b.length && (i === a.length || dp[i * width + j + 1] >= dp[(i + 1) * width + j])) replacement.push(b[j++]);
      else i++;
    }
  }
  flush(); return hunks;
}

/** Merge independent line edits. Overlapping hunks and oversized inputs fail closed. */
export function mergePageEdits(base, edited, fresh) {
  if ([base, edited, fresh].some(x => typeof x !== "string") || Math.max(base.length, edited.length, fresh.length) > MAX_MARKDOWN)
    return { status: "conflict", reason: "Page text is missing or exceeds the safe size limit." };
  if (edited === base) return { status: "merged", text: fresh };
  if (fresh === base || fresh === edited) return { status: "merged", text: edited };
  const left = diffHunks(base, edited), right = diffHunks(base, fresh);
  if (!left || !right) return { status: "conflict", reason: "The page is too large for a bounded automatic merge." };
  const combined = [...left.map(h => ({ ...h, side: 0 })), ...right.map(h => ({ ...h, side: 1 }))].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < combined.length; i++) for (let j = i + 1; j < combined.length; j++) {
    const a = combined[i], b = combined[j];
    const aInsert = a.start === a.end, bInsert = b.start === b.end;
    const sameBoundaryInsert = a.start === b.start && (aInsert || bInsert);
    const insertInsideOther = aInsert && b.start < a.start && a.start < b.end ||
      bInsert && a.start < b.start && b.start < a.end;
    const rangeOverlap = Math.max(a.start, b.start) < Math.min(a.end, b.end);
    if (a.side !== b.side && (sameBoundaryInsert || insertInsideOther || rangeOverlap))
      return { status: "conflict", reason: "Both the Obsidian edit and new transcription changed the same page lines." };
  }
  const source = lines(base); let cursor = 0; const output = [];
  for (const h of combined) {
    output.push(...source.slice(cursor, h.start), h.replacement);
    cursor = h.end;
  }
  output.push(...source.slice(cursor));
  return { status: "merged", text: output.join("") };
}

/** Validate a model-proposed merge without allowing it to erase user-authored markup. */
export function validateReconciledText(edited, proposal) {
  if (typeof edited !== "string" || typeof proposal !== "string" || proposal.length > 1_000_000)
    return { valid: false, reason: "The proposed reconciliation is missing or too large." };
  if (/^---(?:\r?\n)[\s\S]*?(?:\r?\n)---(?:\r?\n|$)/.test(proposal))
    return { valid: false, reason: "A page reconciliation cannot add document frontmatter." };
  // A real page boundary can only live in the document wrapper. Never allow a
  // page proposal to forge one, even if the same marker appeared in an example
  // fenced as code in the original body.
  const proposedAnchors = anchors(proposal, []);
  if (proposedAnchors.error || proposedAnchors.anchors.length)
    return { valid: false, reason: "A page reconciliation cannot add or move a page boundary." };
  const reserved = /<!--[ \t]*(?:supernote-page:[\s\S]*?|supernote-empty-page[\s\S]*?|supernote-continue[\s\S]*?)-->/g;
  const before = [...edited.matchAll(reserved)].map(m => m[0]);
  const after = [...proposal.matchAll(reserved)].map(m => m[0]);
  if (JSON.stringify(after) !== JSON.stringify(before))
    return { valid: false, reason: "The reconciliation added or changed a reserved page comment." };
  const constructs = (text) => {
    const result = [];
    for (const pattern of [/==[\s\S]*?==/g, /~~[\s\S]*?~~/g, /\[[^\]\n]*\]\([^\s)]+(?:\s+[^)]*)?\)/g, /!?\[\[[^\]\n]+\]\]/g, /<!--[\s\S]*?-->/g])
      for (const match of text.matchAll(pattern)) if (!/<!--[ \t]*(?:supernote-page:|supernote-empty-page|supernote-continue)/.test(match[0])) result.push(match[0]);
    return result;
  };
  const required = constructs(edited), offered = constructs(proposal);
  const remaining = [...offered];
  for (const item of required) {
    const index = remaining.indexOf(item);
    if (index < 0) {
      if (item.startsWith("==")) return { valid: false, reason: "The reconciliation changed or removed text inside an Obsidian highlight." };
      return { valid: false, reason: "The reconciliation removed or changed an Obsidian formatting construct, link, or inline comment." };
    }
    remaining.splice(index, 1);
  }
  return { valid: true };
}
