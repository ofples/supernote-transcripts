/** Operational plugin data lives separately from the Markdown people read. */
export const DATA_ROOT = "_supernote";
export const SHARED_ROOT = `${DATA_ROOT}/Shared Data`;
export const HISTORY_ROOT = `${DATA_ROOT}/History`;
export const ARCHIVE_ROOT = `${DATA_ROOT}/Archive`;
export const GLOSSARY_ROOT = `${DATA_ROOT}/Glossaries`;
export const TRANSCRIPTS_ROOT = "Supernote Transcripts";
/** Stable ordinary Markdown locator: dot-prefixed files are not synced by Obsidian. */
export const STORAGE_LOCATOR = "_supernote-storage.md";

export function validateSupportFolder(value: string): string {
  if(typeof value!=="string")throw Error("Choose a support folder within this vault.");
  const path=value.trim().replace(/\\/g,"/").replace(/\/$/,"");
  const segments=path.split("/");
  if(!path||path.length>180||segments.some(p=>!p||p.startsWith(".")||p!==p.trim()||/[. ]$/.test(p)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))||/[<>:"|?*\u0000-\u001f]/.test(path)||/\.(?:md|note)$/i.test(path))
    throw Error("Use a normal vault folder, without hidden dot folders, reserved names or parent-directory segments. Dot folders cannot sync between devices.");
  return path;
}
export function supportPaths(root=DATA_ROOT) {
  return {root,shared:`${root}/Shared Data`,history:`${root}/History`,archive:`${root}/Archive`,glossaries:`${root}/Glossaries`};
}

/** Known locations from older releases. These are explicit migration inputs. */
export const LEGACY_STORAGE_MOVES = [
  { from: "Supernote Transcripts/Shared Data", to: SHARED_ROOT },
  { from: "Supernote Transcripts/History", to: HISTORY_ROOT },
  { from: "Supernote Transcripts/Archive", to: ARCHIVE_ROOT },
  { from: "Supernote Transcripts/Glossaries", to: GLOSSARY_ROOT },
  { from: "Supernote Transcripts/Transcripts", to: TRANSCRIPTS_ROOT },
] as const;

/** Map only known legacy locations; leave every other user path unchanged. */
export function migrateVaultPath(path: string): string {
  for (const move of LEGACY_STORAGE_MOVES) {
    const prefix = `${move.from}/`;
    if (path.toLowerCase() === move.from.toLowerCase()) return move.to;
    if (path.toLowerCase().startsWith(prefix.toLowerCase()))
      return `${move.to}/${path.slice(prefix.length)}`;
  }
  return path;
}

/** True for operational folders, including their known legacy locations. */
export function isDataPath(path: string, root=DATA_ROOT): boolean {
  const current = migrateVaultPath(path);
  return [root,DATA_ROOT].some(base=>current.toLowerCase() === base.toLowerCase() ||
    current.toLowerCase().startsWith(`${base.toLowerCase()}/`)) || current.toLowerCase()===STORAGE_LOCATOR.toLowerCase();
}
