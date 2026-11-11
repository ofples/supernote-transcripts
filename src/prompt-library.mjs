/** @typedef {"recognition" | "cleanup"} PromptScope */
/** @typedef {{id: string, name: string, scope: PromptScope, text: string, revision: number, createdAt: string}} PromptRevision */
/** @typedef {{id: string, revision: number}} PromptRef */

const scopes = new Set(["recognition", "cleanup"]);
const validId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
const validName = (name) => typeof name === "string" && name.trim() === name &&
  name.length > 0 && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name);
const validTimestamp = (value) => typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** @param {unknown} value @returns {value is PromptRevision} */
export function validPromptVersion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = /** @type {Partial<PromptRevision>} */ (value);
  return validId(entry.id) && validName(entry.name) && scopes.has(entry.scope) &&
    typeof entry.text === "string" && !!entry.text.trim() && entry.text.length <= 20000 &&
    Number.isSafeInteger(entry.revision) && entry.revision > 0 && validTimestamp(entry.createdAt);
}

/** @param {unknown} value @returns {value is PromptRef} */
export function validPromptReference(value) {
  if (!value || typeof value !== "object") return false;
  const ref = /** @type {Partial<PromptRef>} */ (value);
  return validId(ref.id) && Number.isSafeInteger(ref.revision) && ref.revision > 0;
}

/** Validate complete, append-ordered immutable histories before using saved data. @param {unknown} value */
export function validatePromptLibrary(value) {
  if (!Array.isArray(value) || value.length > 5000) throw Error("The prompt library could not be loaded safely.");
  /** @type {Map<string, {revision: number, scope: PromptScope}>} */
  const latest = new Map();
  for (const entry of value) {
    if (!validPromptVersion(entry))
      throw Error("A saved prompt revision is invalid. Restore the prompt library from a settings backup.");
    const previous = latest.get(entry.id);
    if (entry.revision !== (previous?.revision ?? 0) + 1 || (previous && previous.scope !== entry.scope))
      throw Error("A saved prompt history is incomplete or has conflicting revisions.");
    latest.set(entry.id, { revision: entry.revision, scope: entry.scope });
  }
  return true;
}

/** @param {PromptRevision[]} library @param {{id: string, name: string, scope: PromptScope, text: string}} draft @param {string} createdAt @param {number} expectedRevision @returns {PromptRevision[]} */
export function appendPromptRevision(library, draft, createdAt, expectedRevision) {
  validatePromptLibrary(library);
  if (!draft || !validId(draft.id) || !validName(draft.name) || !scopes.has(draft.scope) ||
      typeof draft.text !== "string" || !draft.text.trim() || draft.text.length > 20000 || !validTimestamp(createdAt))
    throw Error("Enter a valid prompt name and non-empty prompt text.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw Error("The expected prompt revision is invalid. Reload Prompt library and try again.");
  const history = library.filter(entry => entry.id === draft.id);
  const previous = history.at(-1);
  const actualRevision = previous?.revision ?? 0;
  if (actualRevision !== expectedRevision)
    throw Error("This prompt changed elsewhere. Reload Prompt library before saving your revision.");
  if (previous && previous.scope !== draft.scope)
    throw Error("A prompt cannot change between recognition and cleanup. Duplicate it to create a prompt in the other category.");
  const entry = /** @type {PromptRevision} */ ({
    id: draft.id,
    name: draft.name,
    scope: draft.scope,
    text: draft.text,
    revision: actualRevision + 1,
    createdAt,
  });
  const updated = [...library, entry];
  validatePromptLibrary(updated);
  return updated;
}

/** Duplicate a saved revision as a new prompt ID while preserving its exact text. @param {PromptRevision[]} library @param {PromptRef} ref @param {{id: string, name: string}} duplicate @param {string} createdAt @returns {PromptRevision[]} */
export function duplicatePromptRevision(library, ref, duplicate, createdAt) {
  const source = resolvePromptVersion(library, ref);
  if (!source) throw Error("Choose a saved prompt revision to duplicate.");
  if (!duplicate || !validId(duplicate.id) || library.some(entry => entry.id === duplicate.id))
    throw Error("A duplicate prompt needs a new, unique ID.");
  return appendPromptRevision(library, {
    id: duplicate.id,
    name: duplicate.name,
    scope: source.scope,
    text: source.text,
  }, createdAt, 0);
}

/** Resolve only explicit, well-formed bindings. An omitted binding preserves legacy inline-text behavior. @param {PromptRevision[]} library @param {PromptRef | undefined} ref @param {PromptScope} [scope] @returns {PromptRevision | undefined} */
export function resolvePromptVersion(library, ref, scope) {
  if (ref === undefined) return undefined;
  validatePromptLibrary(library);
  if (!validPromptReference(ref))
    throw Error("The selected prompt reference is invalid. Choose a revision in Prompt library.");
  if (scope !== undefined && !scopes.has(scope)) throw Error("The requested prompt category is invalid.");
  const entry = library.find(candidate => candidate.id === ref.id && candidate.revision === ref.revision);
  if (!entry || (scope !== undefined && entry.scope !== scope))
    throw Error("The selected prompt revision is unavailable. Choose a revision in Prompt library.");
  return entry;
}
