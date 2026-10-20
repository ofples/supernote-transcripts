import { DATA_ROOT, STORAGE_LOCATOR, validateSupportFolder } from "./storage-paths";
import type { ConfigV1, Store } from "./types";
import type { StructureIO } from "./structure-migration";

export interface StorageLayout {version:1;root:string;previousRoot:string;previousRoots?:string[];revision:string;files:string[]}
export interface StorageMoveJournal {from:string;to:string;layout:StorageLayout;baseRevision?:string}
const HEADER="<!-- supernote-storage-v1 -->\n";
const beneath=(p:string,root:string)=>p.toLowerCase()===root.toLowerCase()||p.toLowerCase().startsWith(root.toLowerCase()+"/");
function relative(path:string):boolean {
  return !!path&&path.length<1024&&!/[\\<>:"|?*\u0000-\u001f]/.test(path)&&!path.split("/").some(p=>!p||p==="."||p==="..");
}
export function decodeStorageLayout(text:string):StorageLayout {
  if(text.length>4_000_000||!text.startsWith(HEADER))throw Error("The shared storage location is unreadable. Review Storage settings before updating.");
  const value=JSON.parse(text.slice(HEADER.length));
  if(value?.version!==1||validateSupportFolder(value.root)!==value.root||validateSupportFolder(value.previousRoot)!==value.previousRoot||
      typeof value.revision!=="string"||!/^[a-f0-9-]{36}$/.test(value.revision)||!Array.isArray(value.files)||value.files.length>30000||
      value.files.some((p:unknown)=>typeof p!=="string"||!relative(p))||new Set(value.files).size!==value.files.length||
      value.previousRoots!==undefined&&(!Array.isArray(value.previousRoots)||value.previousRoots.length>100||value.previousRoots.some((p:unknown)=>typeof p!=="string"||validateSupportFolder(p)!==p)))
    throw Error("The shared storage location is invalid. Review Storage settings before updating.");
  return value;
}
export const encodeStorageLayout=(value:StorageLayout)=>HEADER+JSON.stringify(value,null,2)+"\n";
export function validateSupportDestination(root:string,config:ConfigV1,store:Store,oldRoot=DATA_ROOT):string {
  root=validateSupportFolder(root);
  if(root.toLowerCase()!==oldRoot.toLowerCase()&&(beneath(root,oldRoot)||beneath(oldRoot,root)))throw Error("The new support folder must be separate from its current folder.");
  for(const output of ["Supernote Transcripts",...config.rules.map(r=>r.output),...Object.values(store.notebooks).map(s=>s.output).filter(p=>!beneath(p,`${oldRoot}/Archive`))]){
    if(output&&(beneath(root,output)||beneath(output,root)))throw Error("Keep support data separate from transcript folders.");
  }
  for(const rule of config.rules){
    const source=rule.source.replace(/\\/g,"/");
    if(!source.startsWith("/")&&!/^[A-Z]:/i.test(source)&&(beneath(root,source)||beneath(source,root)))throw Error("Keep support data separate from original notebooks.");
  }
  return root;
}
/** Snapshot paths once during an explicit move; never scan handwriting or request recognition. */
export async function makeStorageLayout(io:StructureIO,from:string,to:string):Promise<StorageLayout> {
  const files:string[]=[],queue=[from];let visited=0;
  while(queue.length){
    const folder=queue.shift()!;
    if(++visited>30000||folder.split("/").length>64)throw Error("Support data is too large to move safely.");
    if(!await io.exists(folder))continue;
    const entries=await io.list(folder);
    for(const path of [...entries.files,...entries.folders])if(!path.startsWith(folder+"/")||path.slice(folder.length+1).includes("/")||!relative(path))throw Error("The vault returned an unsafe support-data listing.");
    files.push(...entries.files.filter(p=>!p.split("/").some(part=>part.startsWith("."))).map(p=>p.slice(from.length+1)));
    queue.push(...entries.folders.filter(p=>!p.split("/").some(part=>part.startsWith("."))));
    if(files.length>30000)throw Error("Support data is too large to move safely.");
  }
  return {version:1,root:to,previousRoot:from,revision:crypto.randomUUID(),files:files.sort()};
}
/** A receiver switches only after the rename's snapshot has arrived through Sync. */
export async function storageLayoutReady(io:Pick<StructureIO,"exists">,layout:StorageLayout):Promise<boolean> {
  if(!await io.exists(layout.root))return false;
  // Bound parallelism rather than thousands of simultaneous adapter requests on Android.
  for(let i=0;i<layout.files.length;i+=16){
    if((await Promise.all(layout.files.slice(i,i+16).map(p=>io.exists(`${layout.root}/${p}`)))).some(ok=>!ok))return false;
  }
  return true;
}
/** Rename the whole tree only into an absent destination; a journal makes interruption resumable. */
export async function executeSupportMove(io:StructureIO,journal:StorageMoveJournal):Promise<void> {
  const {from,to,layout}=journal;
  if(layout.root!==to||layout.previousRoot!==from)throw Error("The support-folder move record is invalid.");
  decodeStorageLayout(encodeStorageLayout(layout));
  const source=await io.exists(from);let destination=await io.exists(to);
  if(source&&destination){
    const listing=await io.list(to);
    if(listing.files.length||listing.folders.length)throw Error("Both support folders exist. Both were preserved; choose an empty destination or resolve the duplicate folders first.");
    // rmdir must refuse a folder that gained contents after this check.
    await io.rmdir(to);destination=false;
  }
  if(!source&&!destination&&layout.files.length)throw Error("Support data is missing from both locations. Check Sync before retrying the move.");
  if(!destination){
    const parts=to.split("/");for(let i=1;i<parts.length;i++){const p=parts.slice(0,i).join("/");if(!await io.exists(p))await io.mkdir(p);}
    if(source)await io.rename(from,to);else await io.mkdir(to);
  }
  if(!await storageLayoutReady(io,layout))throw Error("The support-folder move is incomplete. Existing files are preserved; retry after Sync settles.");
}
/** Change only support paths; paid recognition recipes and per-page records remain intact. */
export function remapSupportReferences(config:ConfigV1,store:Store,from:string,to:string):void {
  const map=(p:string)=>beneath(p,from)?to+p.slice(from.length):p;
  for(const profile of config.profiles)profile.glossaries=profile.glossaries.map(map);
  for(const rule of config.rules){
    // Preserve exact causal baselines; publish relocated references as a normal edit.
    if(rule.sharedBaseline?.profile?.glossaries.some(p=>map(p)!==p))rule.sharedPending=true;
  }
  store.history=store.history.map(map);
  for(const state of Object.values(store.notebooks)){
    state.output=map(state.output);
    if(state.outputOverride)state.outputOverride=map(state.outputOverride);
  }
  config.supportFolder=to;
}
export { STORAGE_LOCATOR };
