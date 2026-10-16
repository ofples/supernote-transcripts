import { CONTINUE_PAGE_TEXT, EMPTY_PAGE_TEXT } from "./prompts.mjs";
import { displayedPageText } from "./provenance.mjs";
const pathParts = (value) => value.split("/");
export function validateSource(value, platform) {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const android = path.startsWith("/storage/emulated/0/Note/") || path === "/storage/emulated/0/Note";
  if (
    platform === "nomad" ? !android : !/^([a-zA-Z]:\/|\/)/.test(path)
  )
    throw new Error(platform === "nomad" ? "Source must be inside /storage/emulated/0/Note." : "Choose an absolute local source folder or .note path.");
  if (
    pathParts(path).some((p) => p === "." || p === "..") ||
    /[\u0000-\u001f\\]/.test(path)
  )
    throw new Error("Invalid source path.");
  return path;
}
export function validateDestination(value) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    pathParts(value).some(
      (p) => !p || p === "." || p === ".." || p.startsWith("."),
    ) ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error("Choose a normal folder inside this vault.");
  return value;
}
export function ruleFor(path, rules) {
  return rules
    .filter(
      (r) =>
        r.enabled &&
        (path === r.source ||
          path.startsWith(r.source.replace(/\/+$/, "") + "/")),
    )
    .sort((a, b) => b.source.length - a.source.length)[0];
}
export function relativeToRule(path, rule) {
  const source = validateSource(rule.source);
  const relative = source.toLowerCase().endsWith(".note")
    ? source.split("/").pop()
    : path.slice(source.length + 1);
  if (
    !relative ||
    relative.split("/").some((p) => !p || p === "." || p === "..") ||
    !relative.toLowerCase().endsWith(".note")
  )
    throw new Error("Invalid notebook path.");
  return relative;
}
export function mirrorPath(path, rule) {
  validateDestination(rule.output);
  return `${rule.output}/${relativeToRule(path, rule).slice(0, -5)}.md`;
}
export function excluded(path, source, exclude) {
  const relative = source.toLowerCase().endsWith(".note")
    ? path.split("/").pop()
    : path.slice(source.replace(/\/+$/, "").length + 1);
  return excludedRelative(relative, exclude);
}
// Glob syntax is intentionally small: * and ? stay within one path component;
// ** spans directories. Exact directory paths still exclude their descendants.
export function excludedRelative(relative, patterns) {
  const ancestors = relative
    .split("/")
    .map((_, i, parts) => parts.slice(0, i + 1).join("/"));
  return patterns.some((raw) => {
    const value = raw.trim().replace(/^\/+|\/+$/g, "");
    if (!value) return false;
    let expression = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\" && value[i + 1] !== undefined) {
        expression += value[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      } else if (ch === "*" && value[i + 1] === "*") {
        i++;
        if (value[i + 1] === "/") {
          i++;
          expression += "(?:.*/)?";
        } else expression += ".*";
      } else if (ch === "*") expression += "[^/]*";
      else if (ch === "?") expression += "[^/]";
      else expression += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    const matcher = new RegExp(`^${expression}$`);
    return ancestors.some((path) => matcher.test(path));
  });
}
export function literalExclusion(path) {
  return path.replace(/[\\*?]/g, "\\$&");
}
export function orderedTasks(queue) {
  return [...queue].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      (b.modified ?? 0) - (a.modified ?? 0),
  );
}
export function reconcilePages(oldPages, descriptors) {
  const byFingerprint = new Map();
  for (const page of Object.values(oldPages))
    if (page.text && !page.legacyRenderHash)
      byFingerprint.set(page.fingerprint, page);
  const pages = {};
  for (const page of descriptors) {
    const previous = oldPages[page.id] ?? byFingerprint.get(page.fingerprint);
    if (previous) pages[page.id] = { ...previous, number: page.number };
  }
  return { order: descriptors.map((p) => p.id), pages };
}
export function pendingPages(notebook, force = false) {
  return notebook.desired.filter(
    (p) => (force || notebook.forcePending?.includes(p.id) || notebook.pages[p.id]?.fingerprint !== p.fingerprint) &&
      notebook.pageIssues?.[p.id]?.fingerprint !== p.fingerprint,
  );
}
export function pageIdentity(nativeId, fingerprint, counts, seen) {
  const unique = nativeId && counts.get(nativeId) === 1;
  const base = unique ? `native:${nativeId}` : `content:${fingerprint}`;
  const occurrence = (seen.get(base) ?? 0) + 1;
  seen.set(base, occurrence);
  return occurrence === 1 ? base : `${base}:${occurrence}`;
}
export function recognizeRename(descriptors, notebooks) {
  const wanted = new Set(descriptors.map((p) => p.id));
  if (!wanted.size) return null;
  const candidates = notebooks.filter(
    (n) =>
      n.order.length === wanted.size && n.order.every((id) => wanted.has(id)),
  );
  return candidates.length === 1 ? candidates[0] : null;
}
export function buildMarkdown(notebook, showPageHeadings = true) {
  const name = notebook.output.split("/").pop().replace(/\.md$/i, "");
  const incomplete = notebook.desired.filter(
    (p) => notebook.pages[p.id]?.fingerprint !== p.fingerprint,
  ).length;
  const pageRows = notebook.desired.map((p, index) => {
        const result = notebook.pages[p.id];
        const issue = notebook.pageIssues?.[p.id]?.fingerprint === p.fingerprint ? notebook.pageIssues[p.id] : undefined;
        const notice = issue?.status === "skipped" ? issue.force ? "*Requested reprocessing skipped; previous transcription retained.*" : "*Page skipped by you; no current transcription is claimed.*" : issue ? "*This page could not be recognized. Retry it explicitly or skip it in Supernote Transcripts.*" : "";
        const layer = displayedPageText(notebook, p);
        const rawText = layer.text;
        const joinsPrevious = rawText.startsWith(CONTINUE_PAGE_TEXT);
        const body = (rawText.trim() === EMPTY_PAGE_TEXT ? "" : continuation(rawText) || (rawText ? "" :
          (issue?.status === "skipped" ? "*Page skipped by you; no transcription is claimed.*" :
           issue ? "*This page could not be recognized. Retry it explicitly or skip it in Supernote Transcripts.*" : "*Awaiting recognition.*"))) + (result&&notice?`\n\n${notice}`:"");
        const stale =
          layer.stale
            ? "\n\n> Previous transcription; this page has changed."
            : "";
        const current = !!rawText && !layer.stale && !issue;
        return { p, index, result, body: body.trim(), stale, joinsPrevious, current };
      });
  if (!showPageHeadings) {
    for (let i = 1; i < pageRows.length; i++) {
      const row = pageRows[i], previous = pageRows[i - 1];
      const owner = previous.segmentOwner ?? previous;
      if (!row.joinsPrevious || !row.current || !previous.current || row.index !== previous.index + 1 ||
          !row.body || !owner.body || row.stale || previous.stale) continue;
      const nextFirst = row.body.split("\n", 1)[0];
      if (unsafeContinuationBoundary(owner.body, row.body)) continue;
      const boundary = ` <!-- supernote-page:${encodeURIComponent(row.p.id)} number:${row.p.number} --> `;
      owner.body = `${owner.body}${boundary}${nextFirst}` + row.body.slice(nextFirst.length);
      row.body = "";
      row.omitMarker = true;
      row.segmentOwner = owner;
    }
  }
  return `---\nnomad_transcripts: true\nsupernote_transcripts_version: 1\n---\n\n# ${name}\n\n` +
    (incomplete ? `> ${incomplete} page(s) awaiting recognition or an updated transcription.${notebook.desired.some(p => displayedPageText(notebook,p).provisional) ? " Device OCR is shown provisionally where available." : ""}\n\n` : "") +
    pageRows.map(({ p, body, stale, omitMarker }) => {
      if (omitMarker) return "";
      const marker = showPageHeadings ? `## Page ${p.number}` : `<!-- supernote-page:${encodeURIComponent(p.id)} number:${p.number} -->`;
      return `${marker}\n\n${body}${stale}\n`;
    }).filter(Boolean).join("\n");
}
export function profileNeedsRefresh(notebook, recipe) {
  return Object.values(notebook.pages).some((page) => page.recipe !== recipe);
}

const cleanText = (value) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
const continuation = (text) => text.startsWith(CONTINUE_PAGE_TEXT) ? text.slice(CONTINUE_PAGE_TEXT.length).trimStart() : text;
function unsafeContinuationBoundary(previous, next) {
  const lines = previous.split("\n");
  let fence = "";
  for (const line of lines) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1][0];
    fence = fence === marker ? "" : fence || marker;
  }
  if (fence) return true;
  const before = lines.at(-1)?.trim() ?? "";
  const first = next.split("\n", 1)[0].trim();
  const heading = /^#{1,6}\s/;
  const list = /^(?:[-+*]\s|\d+[.)]\s)/;
  const table = /\|/;
  const quote = /^>/;
  const rule = /^(?:-{3,}|\*{3,}|_{3,})$/;
  const fenceLine = /^(?:`{3,}|~{3,})/;
  return heading.test(before) || fenceLine.test(before) || table.test(before) || quote.test(before) || rule.test(before) ||
    heading.test(first) || fenceLine.test(first) || table.test(first) || quote.test(first) || rule.test(first) || list.test(first);
}

/** Parse one structured response; valid siblings survive malformed entries. */
export function parseRecognitionGroup(raw, targets, { allowLegacy = false, availablePages = /** @type {number[] | undefined} */ (undefined) } = {}) {
  const wanted = new Map(targets.map((page) => [page.number, page]));
  const failures = [];
  const results = [];
  let decoded;
  try { decoded = JSON.parse(raw); } catch {
    if (allowLegacy && targets.length === 1 && typeof raw === "string" && raw.trim()) {
      const text = cleanText(raw);
      if (text) return { results: [{ page: targets[0], text }], failures: [] };
    }
    return { results, failures: targets.map((page) => ({ page, reason: "The recognition response was not valid structured JSON." })) };
  }
  const entries = decoded && Array.isArray(decoded.pages) ? decoded.pages : null;
  if (!entries) return { results, failures: targets.map((page) => ({ page, reason: "The recognition response did not contain a pages list." })) };
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.number) || !wanted.has(entry.number)) continue;
    const page = wanted.get(entry.number);
    seen.set(page.number, (seen.get(page.number) ?? 0) + 1);
    if (seen.get(page.number) > 1) {
      const resultIndex = results.findIndex((result) => result.page === page);
      if (resultIndex >= 0) results.splice(resultIndex, 1);
      continue;
    }
    if (typeof entry.text !== "string" || typeof entry.joinPrevious !== "boolean") continue;
    if (!entry.text.trim()) {
      failures.push({ page, reason: "The recognition response contained no transcription text for this page.", kind: "empty_response" });
      continue;
    }
    let text = cleanText(entry.text);
    while (text.startsWith(CONTINUE_PAGE_TEXT)) text = text.slice(CONTINUE_PAGE_TEXT.length).trimStart();
    if (!text) continue;
    if (text !== EMPTY_PAGE_TEXT && entry.joinPrevious && (!availablePages || availablePages.includes(page.number - 1))) text = `${CONTINUE_PAGE_TEXT}\n${text}`;
    results.push({ page, text });
  }
  for (const page of targets) {
    if (failures.some((failure) => failure.page === page)) continue;
    if (seen.get(page.number) !== 1) failures.push({ page, reason: "The recognition response omitted this page or repeated its page number.", kind: "incomplete" });
    else if (!results.some((result) => result.page === page)) failures.push({ page, reason: "The recognition response did not provide valid transcription text and continuation metadata.", kind: "incomplete" });
  }
  failures.sort((a, b) => targets.indexOf(a.page) - targets.indexOf(b.page));
  return { results, failures };
}
