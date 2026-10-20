import type { ConfigV1, FolderRule, Store } from "./types";
import { LEGACY_STORAGE_MOVES, migrateVaultPath, TRANSCRIPTS_ROOT, isDataPath } from "./storage-paths";
import { notebookIdentityFor } from "./notebook-identity";
import { excluded, literalExclusion, relativeToRule, ruleFor, validateSource, validateDestination } from "./reconcile.mjs";

export interface StructureIO {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  mkdir(path: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  rmdir(path: string): Promise<unknown>;
}
export interface StructureMove { from: string; to: string; duplicate?: boolean; expected?: string }

/** Reader v1 annotation IDs include the source path. Never silently orphan one. */
export async function assertReaderRelocationSafe(io: StructureIO): Promise<void> {
  if(!await io.exists("Reader Highlights"))return;
  const entries=await io.list("Reader Highlights");
  for(const path of entries.files){
    if(!path.startsWith("Reader Highlights/")||path.slice("Reader Highlights/".length).includes("/")||!/\.md$/i.test(path))continue;
    const text=await io.read(path),header="<!-- md-reader-highlight:v1\n",end=text.indexOf("\n-->");
    if(!text.startsWith(header)||end<0)continue;
    let source:unknown;
    try{source=JSON.parse(text.slice(header.length,end)).source;}catch{if(text.includes("Supernote Transcripts/Transcripts/"))throw Error("A Reader highlight needs review before its transcript can move. Its source and highlight were preserved.");continue;}
    if(typeof source==="string"&&migrateVaultPath(source)!==source)
      throw Error("Reader highlights refer to the former transcript folder. Moving it would unlink those highlights, so no files were moved. Keep the folder in place until Reader supports relocating its saved highlights.");
  }
}

/** Preflight the complete move before changing any paths. Never replace a different file. */
export async function planStorageMoves(io: StructureIO, roots:readonly {from:string;to:string}[]=LEGACY_STORAGE_MOVES): Promise<StructureMove[]> {
  const moves: StructureMove[] = [];
  let visited = 0;
  const visit = async (from: string, to: string, folder: boolean, depth: number) => {
    if (++visited > 30_000 || depth > 64) throw Error("Support data is too large to reorganize safely in one pass.");
    if (!await io.exists(to)) { moves.push({ from, to }); return; }
    if (!folder) {
      const before = await io.read(from), after = await io.read(to);
      if (before !== after) throw Error(`Both ${from} and ${to} exist with different contents. Both were kept; resolve the difference before reorganizing.`);
      moves.push({ from, to, duplicate: true, expected: before });
      return;
    }
    const entries = await io.list(from);
    for (const file of entries.files) {
      if (!file.startsWith(`${from}/`) || file.slice(from.length + 1).includes("/")) throw Error("The vault returned an unsafe file listing.");
      await visit(file, `${to}/${file.slice(from.length + 1)}`, false, depth + 1);
    }
    for (const child of entries.folders) {
      if (!child.startsWith(`${from}/`) || child.slice(from.length + 1).includes("/")) throw Error("The vault returned an unsafe folder listing.");
      await visit(child, `${to}/${child.slice(from.length + 1)}`, true, depth + 1);
    }
  };
  for (const { from, to } of roots) if (await io.exists(from)) await visit(from, to, true, 0);
  return moves;
}

/** A stopped/interrupted move can be run again: unchanged duplicates are safely reused. */
export async function executeStorageMoves(io: StructureIO, moves: StructureMove[], roots:readonly {from:string}[]=LEGACY_STORAGE_MOVES): Promise<void> {
  for (const move of moves) {
    if (move.duplicate) {
      if (!await io.exists(move.from)) continue;
      if (await io.read(move.from) !== move.expected || !await io.exists(move.to) || await io.read(move.to) !== move.expected)
        throw Error("A file changed during reorganization. Both copies were preserved; retry after Sync settles.");
      await io.remove(move.from);
      continue;
    }
    if (!await io.exists(move.from)) {
      if (await io.exists(move.to)) continue;
      throw Error("A source disappeared during reorganization. Stop and check Sync before retrying.");
    }
    if (await io.exists(move.to)) throw Error("A destination appeared during reorganization. Nothing was overwritten; retry after Sync settles.");
    const parts = move.to.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (!await io.exists(parent)) try { await io.mkdir(parent); } catch (error) { if (!await io.exists(parent)) throw error; }
    }
    await io.rename(move.from, move.to);
  }
  // Remove only empty known legacy directories, including empty merged descendants.
  const prune = async (path: string, depth: number): Promise<void> => {
    if (depth > 64 || !await io.exists(path)) return;
    const listing = await io.list(path);
    for (const child of listing.folders) if (child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/")) await prune(child, depth + 1);
    const after = await io.list(path);
    if (!after.files.length && !after.folders.length) await io.rmdir(path);
  };
  for (const { from } of roots) await prune(from, 0);
}

/** Only references change; paid results, fingerprints, edits, page IDs and receipt hashes do not. */
export function migrateStructureReferences(config: ConfigV1, store: Store): { config: ConfigV1; store: Store; changed: boolean } {
  const nextConfig: ConfigV1 = JSON.parse(JSON.stringify(config));
  const nextStore: Store = JSON.parse(JSON.stringify(store));
  for (const profile of nextConfig.profiles) profile.glossaries = profile.glossaries.map(migrateVaultPath);
  for (const rule of nextConfig.rules) {
    // Keep the last-agreed sharedBaseline exact: the new local path is an edit
    // to publish, not proof that another device has already accepted the move.
    rule.output = migrateVaultPath(rule.output);
    const old = config.rules.find(r => r.id === rule.id);
    const before = config.profiles.find(p => p.id === old?.profileId);
    const after = nextConfig.profiles.find(p => p.id === rule.profileId);
    if (old?.output !== rule.output || JSON.stringify(before?.glossaries) !== JSON.stringify(after?.glossaries)) rule.sharedPending = true;
  }
  for (const state of Object.values(nextStore.notebooks)) {
    state.output = migrateVaultPath(state.output);
    if (state.outputOverride) state.outputOverride = migrateVaultPath(state.outputOverride);
  }
  nextStore.history = [...new Set(nextStore.history.map(migrateVaultPath))];
  return { config: nextConfig, store: nextStore, changed: JSON.stringify(config) !== JSON.stringify(nextConfig) || JSON.stringify(store) !== JSON.stringify(nextStore) };
}

/** Explicit source consolidation. Existing notebooks retain their shared ownership identities. */
export async function consolidateFolder(config: ConfigV1, store: Store, options: {
  source: string; ruleId: string; sharedId: string; profileId: string; output?: string;
  notebooks: string[]; allowed: string[];
}): Promise<{ config: ConfigV1; store: Store; rule: FolderRule }> {
  const source = validateSource(options.source);
  const output = validateDestination(options.output ?? `${TRANSCRIPTS_ROOT}/Reflections`);
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(options.ruleId)||!/^[a-zA-Z0-9_-]{1,128}$/.test(options.sharedId))throw Error("Choose valid local and shared source identities.");
  if(/^[a-z]:/i.test(output))throw Error("Choose an output folder inside the vault.");
  if (isDataPath(output)) throw Error("Choose a transcript folder outside support data.");
  if (/\.note$/i.test(source) || !options.allowed.length || !config.profiles.some(p => p.id === options.profileId)) throw Error("Choose a folder, recognition settings and notebooks to keep enabled.");
  if(config.rules.some(r => r.source.startsWith(`${source}/`) && !/\.note$/i.test(r.source)))
    throw Error("This folder contains separately configured child folders. Reconcile those source settings before combining them.");
  const contained = (p: string) => p.startsWith(`${source}/`) && /\.note$/i.test(p);
  if (new Set(options.notebooks).size !== options.notebooks.length || options.notebooks.some(p => !contained(p)) ||
    new Set(options.allowed).size !== options.allowed.length || options.allowed.some(p => !options.notebooks.includes(p))) throw Error("The folder selection changed; list its notebooks again before continuing.");
  const nextConfig: ConfigV1 = JSON.parse(JSON.stringify(config)), nextStore: Store = JSON.parse(JSON.stringify(store));
  const previous = config.rules.find(r => r.id === options.ruleId);
  const rule: FolderRule = {
    ...(previous ?? {}), id: options.ruleId, sharedId: options.sharedId, enabled: true,
    source, output, recursive: true,
    exclude: options.notebooks.filter(p => !options.allowed.includes(p)).map(p => literalExclusion(p.slice(source.length + 1))).sort(),
    profileId: options.profileId, notebookIds: { ...previous?.notebookIds },
  };
  if(previous&&(previous.sharedId??previous.id)!==options.sharedId){
    delete rule.sharedBaseline;delete rule.sharedRevision;delete rule.sharedAncestors;delete rule.sharedPending;
  }
  // Include cached notebooks even if their local file is temporarily missing.
  for (const path of new Set([...options.notebooks, ...Object.keys(store.notebooks).filter(contained)])) {
    const owner = config.rules.find(r => r.id === store.notebooks[path]?.ruleId) ?? ruleFor(path, config.rules);
    if (owner) rule.notebookIds![relativeToRule(path, rule)] = await notebookIdentityFor(owner, path);
  }
  if (Object.keys(rule.notebookIds!).length === 0) delete rule.notebookIds;
  const removed = new Set(config.rules.filter(r => r.source === source || contained(r.source)).map(r => r.id));
  if (config.rules.some(r => r.id === rule.id && !removed.has(r.id))) throw Error("The target source ID is already used by another folder.");
  nextConfig.rules = nextConfig.rules.filter(r => !removed.has(r.id));
  nextConfig.rules.push(rule);
  for (const state of Object.values(nextStore.notebooks).filter(s => contained(s.source))) {
    state.ruleId = rule.id;
    // Outputs already moved by the storage pass need not move again on discovery.
    const expected = `${rule.output}/${relativeToRule(state.source, rule).slice(0, -5)}.md`;
    if (state.output !== expected && !state.outputOverride) state.outputOverride = state.output;
    if (excluded(state.source, rule.source, rule.exclude)) {
      state.status = "excluded";
      state.error = "Excluded from recognition. Existing transcript is retained.";
    }
  }
  nextStore.queue = nextStore.queue.filter(t => !contained(t.source) || options.allowed.includes(t.source));
  return { config: nextConfig, store: nextStore, rule };
}
