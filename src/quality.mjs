const presets = {
  fast: { mode: "fast", pagesPerRequest: 1, neighborPages: 0, textContextChars: 0, reasoningEffort: "low" },
  balanced: { mode: "balanced", pagesPerRequest: 4, neighborPages: 1, textContextChars: 12000, reasoningEffort: "medium" },
  careful: { mode: "careful", pagesPerRequest: 4, neighborPages: 2, textContextChars: 24000, reasoningEffort: "high" },
};

export function qualitySettings(value) {
  const mode = typeof value === "string" ? value : value?.mode;
  return { ...(presets[mode] ?? presets.fast) };
}

/** Keeps user priority order while grouping only adjacent desired page numbers. */
export function planRecognitionGroups(pending, descriptors, quality) {
  const limit = qualitySettings(quality).pagesPerRequest;
  const desiredIndex = new Map(descriptors.map((page, index) => [page.id, index]));
  const rows = pending.map((page) => ({ page, index: desiredIndex.get(page.id) })).filter((row) => row.index !== undefined);
  const groups = [];
  for (const row of rows) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const direction = previous ? Math.sign(row.index - previous.index) : 0;
    const pageDirection = previous ? Math.sign(row.page.number - previous.page.number) : 0;
    const established = group?.length > 1 ? Math.sign(previous.index - group.at(-2).index) : direction;
    const establishedPage = group?.length > 1 ? Math.sign(previous.page.number - group.at(-2).page.number) : pageDirection;
    if (group && group.length < limit && Math.abs(row.index - previous.index) === 1 &&
        Math.abs(row.page.number - previous.page.number) === 1 && direction === established && pageDirection === establishedPage) group.push(row);
    else groups.push([row]);
  }
  return groups.map((group) => group.map(({ page }) => page));
}

/** Selects nearby descriptor pages that are not request targets. */
export function contextPages(targets, descriptors, quality) {
  const count = qualitySettings(quality).neighborPages;
  if (!count) return [];
  const byId = new Map(descriptors.map((page, index) => [page.id, index]));
  const targetIds = new Set(targets.map((page) => page.id));
  const indexes = targets.map((page) => byId.get(page.id)).filter(Number.isInteger);
  if (!indexes.length) return [];
  const selected = new Set();
  for (let distance = 1; distance <= count; distance++) {
    for (const index of indexes) {
      for (const candidate of [index - distance, index + distance]) {
        const page = descriptors[candidate];
        if (page && !targetIds.has(page.id)) selected.add(candidate);
      }
    }
  }
  return [...selected].sort((a, b) => a - b).map((index) => descriptors[index]);
}
