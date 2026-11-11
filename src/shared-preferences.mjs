import { validateDestination } from "./reconcile.mjs";

const HEADER = "<!-- nomad-transcripts-preferences-v1 -->\n```json\n";
const FOOTER = "\n```\n";
const NAME = "global-preferences.md";
const MAX_ANCESTORS = 256;
const fields = ["profile", "cleanupPrompt", "showPageHeadings"];
const profileFields = ["model", "endpoint", "prompt", "glossaries", "quality", "preserveFormatting", "formattingGuide"];

const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
const canonical = value => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  : Array.isArray(value) ? value.map(canonical) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clone = value => structuredClone(value);

/** A deliberately narrow, non-secret subset of device-independent defaults. */
export function portablePreferences(value) {
  if (!value || typeof value !== "object" || !value.profile || typeof value.showPageHeadings !== "boolean")
    throw Error("Invalid shared preference record.");
  const p = value.profile;
  if (!text(p.model, 300) || !text(p.prompt, 100_000) || !Array.isArray(p.glossaries) || p.glossaries.length > 100)
    throw Error("Invalid shared default transcription profile.");
  let endpoint;
  try { endpoint = new URL(p.endpoint); } catch { throw Error("Invalid shared provider endpoint."); }
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw Error("Shared provider endpoints cannot include credentials, queries or fragments.");
  const glossaries = p.glossaries.map(path => {
    if (typeof path !== "string") throw Error("Shared glossary references must be vault paths.");
    validateDestination(path);
    if (/^[a-z]:/i.test(path) || !/\.(md|txt)$/i.test(path)) throw Error("Shared glossary references must be ordinary vault .md/.txt files.");
    return path;
  });
  if (p.quality !== undefined && !["fast", "balanced", "careful"].includes(p.quality)) throw Error("Invalid shared default quality.");
  if (p.preserveFormatting !== undefined && typeof p.preserveFormatting !== "boolean") throw Error("Invalid shared formatting preference.");
  if (p.formattingGuide !== undefined && (typeof p.formattingGuide !== "string" || p.formattingGuide.length > 10_000 || p.formattingGuide.includes("\0")))
    throw Error("Invalid shared formatting cues.");
  if (value.cleanupPrompt !== undefined && (typeof value.cleanupPrompt !== "string" || value.cleanupPrompt.length > 20_000 || value.cleanupPrompt.includes("\0")))
    throw Error("Invalid shared cleanup instructions.");
  return {
    profile: { model: p.model, endpoint: endpoint.href, prompt: p.prompt,
      glossaries, ...(p.quality === undefined ? {} : { quality: p.quality }),
      ...(p.preserveFormatting === undefined ? {} : { preserveFormatting: p.preserveFormatting }),
      ...(p.formattingGuide === undefined ? {} : { formattingGuide: p.formattingGuide }) },
    ...(value.cleanupPrompt === undefined ? {} : { cleanupPrompt: value.cleanupPrompt }),
    showPageHeadings: value.showPageHeadings,
  };
}

export function preferencesEqual(a, b) { return equal(portablePreferences(a), portablePreferences(b)); }

/** Field-wise three-way merge. Conflicting fields remain local until resolved. */
export function reconcilePreferences(local, baseline, remote) {
  const ours = portablePreferences(local), theirs = portablePreferences(remote);
  if (!baseline) return preferencesEqual(ours, theirs)
    ? { value: ours, baseline: theirs, publish: false, conflicts: [] }
    : { value: ours, baseline: undefined, publish: false, conflicts: ["shared defaults"] };
  const before = portablePreferences(baseline), value = clone(ours), conflicts = [];
  const merge = (name, a, b, c) => {
    if (equal(a, c) || equal(c, b)) return a;
    if (equal(a, b)) return c;
    conflicts.push(name); return a;
  };
  for (const key of fields) {
    if (key === "profile") {
      for (const field of profileFields) {
        const merged = merge(`profile.${field}`, ours.profile[field], before.profile[field], theirs.profile[field]);
        if (merged === undefined) delete value.profile[field]; else value.profile[field] = merged;
      }
    } else {
      const merged = merge(key, ours[key], before[key], theirs[key]);
      if (merged === undefined) delete value[key]; else value[key] = merged;
    }
  }
  return conflicts.length ? { value: ours, baseline: before, publish: false, conflicts }
    : { value, baseline: clone(value), publish: !preferencesEqual(value, theirs), conflicts: [] };
}

async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function revision(value) { return hash(JSON.stringify(portablePreferences(value))); }
function encode(record) { return HEADER + JSON.stringify(record) + FOOTER; }
async function decode(body) {
  if (!body.startsWith(HEADER) || !body.endsWith(FOOTER)) throw Error("Invalid shared preferences envelope.");
  const value = JSON.parse(body.slice(HEADER.length, -FOOTER.length));
  if (!value || value.kind !== "preferences" || value.version !== 1 || !digest(value.revision) ||
      !Array.isArray(value.ancestors) || value.ancestors.length > MAX_ANCESTORS ||
      value.ancestors.some(item => !digest(item) || item === value.revision) || new Set(value.ancestors).size !== value.ancestors.length)
    throw Error("Invalid shared preferences revision history.");
  const preferences = portablePreferences(value.preferences);
  if (value.revision !== await revision(preferences)) throw Error("Shared preferences revision does not match its values.");
  return { preferences, revision: value.revision, ancestors: [...value.ancestors] };
}

/** One Markdown record synchronized by Obsidian Sync; never includes device/session data. */
export class SharedPreferencesStore {
  constructor(io, root) { this.io = io; this.folder = `${root}/Preferences`; this.path = `${this.folder}/${NAME}`; this.issues = []; }
  async load() {
    this.issues = [];
    if (!await this.io.exists(this.folder)) return undefined;
    const { files } = await this.io.list(this.folder);
    const conflicts = files.filter(path => path === this.path || path.startsWith(`${this.folder}/global-preferences (`) && path.endsWith(").md"));
    if (conflicts.length > 1) throw Error("A Sync conflict copy exists for shared preferences. Resolve its Markdown copies before syncing defaults.");
    if (!await this.io.exists(this.path)) {
      const malformed = files.find(path => path.startsWith(`${this.folder}/global-preferences`));
      if (malformed) throw Error("Shared preferences record is damaged. Inspect its Markdown file before syncing defaults.");
      return undefined;
    }
    return decode(await this.io.read(this.path));
  }
  async save(preferences, expectedRevision) {
    const value = portablePreferences(preferences), current = await this.load();
    if ((current?.revision ?? null) !== expectedRevision)
      throw Error("Shared preferences changed while saving. Refresh and resolve differences before retrying.");
    const digestValue = await revision(value);
    if (current?.revision === digestValue) return current;
    const record = { kind: "preferences", version: 1, preferences: value, revision: digestValue,
      ancestors: current ? [...new Set([current.revision, ...current.ancestors])].filter(item => item !== digestValue).slice(0, MAX_ANCESTORS) : [] };
    if (!await this.io.exists(this.folder)) await this.io.mkdir(this.folder);
    if (await this.io.exists(this.path)) await this.io.write(this.path, encode(record));
    else await this.io.create(this.path, encode(record));
    return { preferences: value, revision: digestValue, ancestors: record.ancestors };
  }
}
