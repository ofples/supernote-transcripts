export function pagesFromRange(value, total) {
  const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(value);
  if (!match) throw new Error("Enter one page (3) or a range (3-6).");
  const start = Number(match[1]),
    end = Number(match[2] ?? match[1]);
  if (start < 1 || end < start || end > total)
    throw new Error(`Choose pages between 1 and ${total}.`);
  if (end - start >= 10)
    throw new Error(
      "Select at most 10 pages per manual request. Use Update for notebook batches.",
    );
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
/** Explicit re-recognition accepts lists/ranges; bounds prevent huge expansion. */
export function selectedPageNumbers(value, total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > 100000 || typeof value !== "string" || value.length > 10000)
    throw Error("Choose pages from a readable notebook.");
  const selected = new Set();
  for (const part of value.replace(/[–—]/g, "-").split(",")) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw Error("Enter pages such as 3, 8-12.");
    const start = Number(m[1]), end = Number(m[2] ?? m[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > total)
      throw Error(`Choose pages between 1 and ${total}.`);
    for (let n = start; n <= end; n++) selected.add(n);
  }
  return [...selected].sort((a, b) => a - b);
}
export function outputPath(folder, relative) {
  if (
    !folder ||
    folder.startsWith("/") ||
    folder.split("/").some((p) => !p || p === "." || p === "..") ||
    folder.split("/")[0].startsWith(".")
  )
    throw new Error("Choose a normal folder inside this vault.");
  if (
    !relative.toLowerCase().endsWith(".note") ||
    relative.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw new Error("Invalid notebook path.");
  return `${folder}/${relative.slice(0, -5)}.md`;
}
export function documentText(name, pages) {
  return (
    `---\nnomad_transcripts: true\n---\n\n# ${name}\n\nGenerated transcription. Handwritten originals are unchanged.\n\n` +
    Object.entries(pages)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([n, p]) => `## Page ${n}\n\n${p.text.trim()}\n`)
      .join("\n")
  );
}
export function responseText(json) {
  const text = (json.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  if (json.status !== "completed" || !text)
    throw new Error(
      "The AI response was incomplete or empty. Previous transcript preserved.",
    );
  return text;
}
