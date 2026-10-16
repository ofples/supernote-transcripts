import type { Profile } from "./types";
import { SHARED_ROOT, sharedHash } from "./shared";
import type { SharedIO } from "./shared";
import { validateDestination } from "./reconcile.mjs";

const FOLDER = `${SHARED_ROOT}/Mirrors`;
const HEADER = "<!-- nomad-transcripts-mirror-v1 -->\n```json\n";
const FOOTER = "\n```\n";
export interface PortableMirror {
  profile: Profile;
  output: string;
  recursive: boolean;
  exclude: string[];
}
export interface SharedMirror extends PortableMirror {
  id: string;
  name: string;
}
export interface CatalogProblem { path: string; reason: string }
export class CatalogConflictError extends Error {}
function identity(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
}
function portable(input: PortableMirror): PortableMirror {
  if (!input || !input.profile) throw new Error("A shared mirror requires a profile.");
  const p = input.profile;
  if (!identity(p.id) || !text(p.name, 300) || !text(p.model, 300) || !text(p.prompt, 100_000))
    throw new Error("Invalid shared transcription profile.");
  const endpoint = new URL(p.endpoint);
  // Keys belong in local storage, including keys sometimes embedded in a URL.
  if (!/^(http:|https:)$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Shared provider endpoints cannot include credentials, queries or fragments.");
  validateDestination(input.output);
  if (typeof input.recursive !== "boolean" || !Array.isArray(input.exclude) || input.exclude.length > 20_000 ||
      !Array.isArray(p.glossaries) || p.glossaries.length > 100)
    throw new Error("Invalid shared mirror selection.");
  const glossaries = p.glossaries.map((path) => {
    if (typeof path !== "string") throw new Error("Glossary references must be vault paths.");
    validateDestination(path);
    if (/^[a-z]:/i.test(path) || !/\.(md|txt)$/i.test(path)) throw new Error("Glossary references must be ordinary vault .md/.txt files.");
    return path;
  });
  if (/^[a-z]:/i.test(input.output)) throw new Error("Shared output must be a vault folder.");
  const exclude = input.exclude.map((pattern) => {
    if (!text(pattern, 2_000) || pattern.startsWith("/") || /^[a-z]:/i.test(pattern) ||
        /^[a-z][a-z0-9+.-]*:/i.test(pattern) || /[\u0000-\u001f]/.test(pattern) ||
        pattern.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error("Shared exclusions must be relative notebook patterns.");
    // Backslash may escape a literal glob metacharacter (see literalExclusion).
    // UNC/native Windows paths still contain unescaped path backslashes.
    if (/\\(?![?*\[\]{}()!+.^$\\])/u.test(pattern) || pattern.startsWith("\\\\"))
      throw new Error("Shared exclusions cannot contain native source paths.");
    return pattern;
  });
  // Explicit whitelist strips API keys, source mounts, pauses and execution settings.
  if (p.quality !== undefined && !["fast", "balanced", "careful"].includes(p.quality))
    throw new Error("Invalid shared transcription quality.");
  return { profile: { id: p.id, name: p.name, model: p.model, endpoint: p.endpoint,
    prompt: p.prompt, glossaries, ...(p.quality === undefined ? {} : { quality: p.quality }) }, output: input.output, recursive: input.recursive, exclude };
}
function validate(value: any): SharedMirror {
  if (!value || value.kind !== "mirror" || value.version !== 1 ||
      !identity(value.id) || !text(value.name, 300)) throw new Error("Invalid shared mirror record.");
  return { id: value.id, name: value.name, ...portable(value) };
}
function decode(body: string): SharedMirror {
  if (!body.startsWith(HEADER) || !body.endsWith(FOOTER)) throw new Error("Invalid shared mirror envelope.");
  return validate(JSON.parse(body.slice(HEADER.length, -FOOTER.length)));
}
function encode(mirror: SharedMirror): string {
  return HEADER + JSON.stringify({ kind: "mirror", version: 1, ...mirror }) + FOOTER;
}
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Logical source definitions only. Each device chooses its own local source mount. */
export class MirrorCatalog {
  readonly folder = FOLDER;
  problems: CatalogProblem[] = [];
  constructor(private io: SharedIO) {}
  async list(): Promise<SharedMirror[]> {
    this.problems = [];
    if (!await this.io.exists(this.folder)) return [];
    const { files } = await this.io.list(this.folder);
    const records = new Map<string, { mirror: SharedMirror; body: string; path: string; hash: string }>();
    const conflicted = new Set<string>();
    const damaged = new Set<string>();
    for (const path of files.sort(lexical)) {
      if (!path.startsWith(this.folder + "/") || path.slice(this.folder.length + 1).includes("/") || !path.endsWith(".md")) continue;
      try {
        const mirror = decode(await this.io.read(path));
        const hash = await sharedHash(mirror.id);
        const basename = path.slice(path.lastIndexOf("/") + 1);
        if (basename !== `${hash}.md` && !(basename.startsWith(`${hash} (`) && basename.endsWith(").md")))
          throw new Error("Shared mirror filename does not match its identity.");
        const body = encode(mirror);
        const previous = records.get(mirror.id);
        if (previous && previous.body !== body) {
          conflicted.add(mirror.id);
          this.problems.push({ path, reason: `Conflicting shared definition for ${mirror.name}.` });
        } else records.set(mirror.id, { mirror, body, path, hash });
      } catch (error) {
        const hash = path.slice(path.lastIndexOf("/") + 1).match(/^([a-f0-9]{64})(?:\.md| \()/)?.[1];
        if (hash) damaged.add(hash);
        this.problems.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    // Importing a conflicting catalog could silently change paid recognition recipes.
    return [...records.values()].filter(({ mirror, hash }) => !conflicted.has(mirror.id) && !damaged.has(hash))
      .map(({ mirror }) => mirror).sort((a, b) => lexical(a.name, b.name) || lexical(a.id, b.id));
  }
  async load(id: string): Promise<SharedMirror | undefined> {
    if (!identity(id)) throw new Error("Invalid shared mirror identity.");
    return (await this.list()).find((mirror) => mirror.id === id);
  }
  async save(id: string, name: string, input: PortableMirror): Promise<void> {
    if (!identity(id) || !text(name, 300)) throw new Error("A shared mirror needs a stable ID and readable name.");
    const mirror = { id, name, ...portable(input) };
    const hash = await sharedHash(id);
    const path = `${this.folder}/${hash}.md`;
    await this.list();
    if (this.problems.some((problem) => problem.path === path || problem.path.startsWith(`${this.folder}/${hash} (`)))
      throw new CatalogConflictError("Shared mirror metadata is damaged or conflicting. Inspect its Markdown records before saving.");
    const parts = this.folder.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const parent = parts.slice(0, n).join("/");
      if (!await this.io.exists(parent)) {
        try { await this.io.mkdir(parent); }
        catch (error) { if (!await this.io.exists(parent)) throw error; }
      }
    }
    const body = encode(mirror);
    if (await this.io.exists(path)) await this.io.write(path, body);
    else await this.io.create(path, body);
  }
}
