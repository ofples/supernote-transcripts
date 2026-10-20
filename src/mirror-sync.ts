import type { PortableMirror } from "./catalog";

/** Last successfully reconciled portable values, persisted separately for each local binding. */
export type MirrorBaseline = PortableMirror;
export interface MirrorReconciliation {
  value: PortableMirror;
  baseline?: MirrorBaseline;
  publish: boolean;
  conflicts: string[];
}
const clone = (value: PortableMirror): PortableMirror => ({
  profile: { ...value.profile, glossaries: [...value.profile.glossaries] },
  output: value.output, recursive: value.recursive, exclude: [...value.exclude],
  ...(value.notebookIds === undefined ? {} : { notebookIds: { ...value.notebookIds } }),
  ...(value.automaticCheck === undefined ? {} : { automaticCheck: value.automaticCheck }),
  ...(value.automaticCheckRecentPages === undefined ? {} : { automaticCheckRecentPages: value.automaticCheckRecentPages }),
  ...(value.digestCategoryName === undefined ? {} : { digestCategoryName: value.digestCategoryName }),
});
const canonical = (value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  : Array.isArray(value) ? value.map(canonical) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fields = ["model", "endpoint", "prompt", "glossaries", "quality", "preserveFormatting", "formattingGuide"] as const;
const checkFields = ["automaticCheck", "automaticCheckRecentPages", "notebookIds", "digestCategoryName"] as const;
/** Identity and display names belong to each device; only recipe and selection values reconcile. */
export function portableMirrorEqual(a: PortableMirror, b: PortableMirror): boolean {
  return a.output === b.output && a.recursive === b.recursive && equal(a.exclude, b.exclude) &&
    checkFields.every((key) => equal(a[key], b[key])) &&
    fields.every((key) => equal(key === "quality" ? a.profile[key] ?? "fast" : a.profile[key],
      key === "quality" ? b.profile[key] ?? "fast" : b.profile[key]));
}
/** Three-way merge. A conflict returns the original local value and never advances the baseline. */
export function reconcileMirror(local: PortableMirror, baseline: MirrorBaseline | undefined,
  remote: PortableMirror | undefined): MirrorReconciliation {
  const unchanged = (conflicts: string[]): MirrorReconciliation => ({ value: clone(local), baseline, publish: false, conflicts });
  if (!remote) return baseline ? unchanged(["shared definition was deleted; restore it or explicitly reconnect this source"])
    : { value: clone(local), publish: true, conflicts: [] };
  if (!baseline) return portableMirrorEqual(local, remote)
    ? { value: clone(local), baseline: clone(remote), publish: false, conflicts: [] }
    : unchanged(["existing shared settings differ from this device without a sync baseline; explicitly choose the shared settings or publish the local settings"]);
  const value = clone(local), conflicts: string[] = [];
  const merge = (name: string, ours: unknown, before: unknown, theirs: unknown): unknown => {
    if (equal(ours, theirs) || equal(theirs, before)) return ours;
    if (equal(ours, before)) return theirs;
    conflicts.push(name);
    return ours;
  };
  for (const key of fields) {
    const get = (item: PortableMirror) => key === "quality" ? item.profile[key] ?? "fast" : item.profile[key];
    const merged = merge(`profile.${key}`, get(local), get(baseline), get(remote));
    if (key === "quality" || merged !== undefined) (value.profile as any)[key] = merged;
    else delete (value.profile as any)[key];
  }
  for (const key of ["output", "recursive", "exclude"] as const)
    (value as any)[key] = merge(key, local[key], baseline[key], remote[key]);
  for (const key of checkFields) {
    const merged = merge(key, local[key], baseline[key], remote[key]);
    if (merged === undefined) delete (value as any)[key];
    else (value as any)[key] = merged;
  }
  if (conflicts.length) return unchanged(conflicts);
  return { value: clone(value), baseline: clone(value), publish: !portableMirrorEqual(value, remote), conflicts: [] };
}
