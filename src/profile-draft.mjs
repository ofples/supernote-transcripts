/** @typedef {import("./types").Profile} Profile */
const fields = ["name", "model", "endpoint", "prompt", "glossaries", "quality", "preserveFormatting", "formattingGuide"];
const clone = profile => ({ ...profile, glossaries: [...profile.glossaries] });
const equal = (a, b, field) => JSON.stringify(field === "quality" ? a ?? "fast" : a) ===
  JSON.stringify(field === "quality" ? b ?? "fast" : b);
function index(profiles) {
  const result = new Map();
  for (const profile of profiles) {
    if (result.has(profile.id)) throw Error(`Duplicate recognition settings identity: ${profile.id}. Reopen Settings and try again.`);
    result.set(profile.id, profile);
  }
  return result;
}
/**
 * Reconcile an open Settings draft with profiles that may have arrived through Sync.
 * Profile removal is not supported by this editor; untouched current values always survive.
 * @param {Profile[]} current
 * @param {Profile[]} baseline
 * @param {Profile[]} draft
 * @returns {Profile[]}
 */
export function mergeProfileDrafts(current, baseline, draft) {
  const before = index(baseline), edited = index(draft), now = index(current);
  const result = current.map(clone), output = index(result);
  for (const [id, proposed] of edited) {
    const original = before.get(id), present = now.get(id);
    if (!original) {
      if (!present) { const added = clone(proposed); result.push(added); output.set(id, added); }
      else if (fields.some(field => !equal(proposed[field], present[field], field)))
        throw Error(`Recognition settings "${proposed.name}" were added elsewhere with the same identity. Reopen Settings and apply your changes again.`);
      continue;
    }
    const changed = fields.filter(field => !equal(proposed[field], original[field], field));
    if (!changed.length) continue;
    if (!present) throw Error(`Recognition settings "${original.name}" were removed while this window was open. Reopen Settings before saving changes.`);
    const conflicts = changed.filter(field => !equal(present[field], original[field], field) && !equal(present[field], proposed[field], field));
    if (conflicts.length) throw Error(`Recognition settings "${original.name}" changed elsewhere: ${conflicts.join(", ")}. Reopen Settings and choose which values to keep.`);
    const merged = output.get(id);
    for (const field of changed) {
      if (proposed[field] === undefined) delete merged[field];
      else merged[field] = field === "glossaries" ? [...proposed[field]] : proposed[field];
    }
  }
  return result;
}
