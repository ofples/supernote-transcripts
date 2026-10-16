import { sharedHash, SHARED_ROOT, type SharedIO } from "./shared";
import type { PageDescriptor, NotebookState } from "./types";

const HASH=/^[a-f0-9]{64}$/;
const HEADER="<!-- supernote-publication-v2 -->\n";
type Inventory={id:string;fingerprint:string}[];
type PublishedResult={id:string;fingerprint:string;textHash:string;recipe:string};
export interface Receipt {
  version:2;
  notebookId:string;
  textHash:string;
  pages:Inventory;
  /** Only results actually displayed in this output; awaiting pages are absent. */
  results:PublishedResult[];
  createdAt:number;
  supersedes:string[];
  recordId:string;
  /** Concurrent received publications with no known causal ordering. */
  candidates?:Receipt[];
}
function inventory(pages:Inventory):Inventory {
  if(!Array.isArray(pages)||pages.some(p=>!p||typeof p.id!=="string"||!p.id||typeof p.fingerprint!=="string"||!p.fingerprint)||new Set(pages.map(p=>p.id)).size!==pages.length)
    throw Error("Invalid publication page inventory.");
  return pages.map(({id,fingerprint})=>({id,fingerprint}));
}
function payload(r:Omit<Receipt,"recordId">){
  return {version:2,notebookId:r.notebookId,textHash:r.textHash,pages:r.pages,results:r.results,createdAt:r.createdAt,supersedes:r.supersedes};
}
const envelope=(r:Receipt)=>HEADER+JSON.stringify({...payload(r),recordId:r.recordId})+"\n";
const lexical=(a:string,b:string)=>a<b?-1:a>b?1:0;
function same(a:Inventory,b:Inventory){return a.length===b.length&&a.every((p,i)=>p.id===b[i].id&&p.fingerprint===b[i].fingerprint);}

export class PublicationReceipts {
  constructor(private io:SharedIO,private now:()=>number=Date.now){}
  private folder(id:string,h:string){
    if(!HASH.test(id)||!HASH.test(h))throw Error("Invalid publication identity.");
    return `${SHARED_ROOT}/${id}/publications/${h}`;
  }
  private async received(id:string,h:string):Promise<{tips:Receipt[];invalid:boolean}>{
    const folder=this.folder(id,h);
    if(!await this.io.exists(folder))return {tips:[],invalid:false};
    const {files}=await this.io.list(folder);
    const records=new Map<string,Receipt>();let invalid=false;
    for(const path of files.sort(lexical)){
      if(!path.startsWith(folder+"/")||path.slice(folder.length+1).includes("/")||!path.endsWith(".md"))continue;
      try{
        const raw=await this.io.read(path);
        if(!raw.startsWith(HEADER))throw Error("Malformed publication envelope.");
        const r=JSON.parse(raw.slice(HEADER.length));
        if(!r||r.version!==2||r.notebookId!==id||r.textHash!==h||!HASH.test(r.recordId)||
          !Number.isSafeInteger(r.createdAt)||r.createdAt<0||!Array.isArray(r.supersedes)||
          r.supersedes.some((id:unknown)=>typeof id!=="string"||!HASH.test(id))||
          new Set(r.supersedes).size!==r.supersedes.length||r.supersedes.includes(r.recordId))throw Error("Invalid publication record.");
        r.pages=inventory(r.pages);
        if(!Array.isArray(r.results)||r.results.some((p:any)=>!p||typeof p.id!=="string"||!p.id||
          typeof p.fingerprint!=="string"||!p.fingerprint||!HASH.test(p.textHash)||!HASH.test(p.recipe)||
          !r.pages.some((page:any)=>page.id===p.id))||new Set(r.results.map((p:any)=>p.id)).size!==r.results.length)
          throw Error("Invalid publication result provenance.");
        r.results=r.results.map(({id,fingerprint,textHash,recipe}:PublishedResult)=>({id,fingerprint,textHash,recipe}));
        if(await sharedHash(JSON.stringify(payload(r)))!==r.recordId||!path.slice(path.lastIndexOf("/")+1).startsWith(r.recordId))
          throw Error("Publication metadata integrity failed.");
        records.set(r.recordId,{...payload(r),version:2,recordId:r.recordId});
      }catch{invalid=true;}
    }
    const superseded=new Set([...records.values()].flatMap(r=>r.supersedes));
    const tips=[...records.values()].filter(r=>!superseded.has(r.recordId)).sort((a,b)=>lexical(a.recordId,b.recordId));
    if(records.size&&!tips.length)invalid=true;
    return {tips,invalid};
  }
  async save(id:string,text:string,pages:PageDescriptor[],localResults?:NotebookState["pages"]):Promise<void>{
    const h=await sharedHash(text),ordered=inventory(pages),folder=this.folder(id,h);
    const results:PublishedResult[]=[];
    for(const page of ordered){
      const result=localResults?.[page.id];if(!result)continue;
      if(typeof result.text!=="string"||typeof result.fingerprint!=="string"||!result.fingerprint||!HASH.test(result.recipe))
        throw Error("Invalid publication result provenance.");
      results.push({id:page.id,fingerprint:result.fingerprint,textHash:await sharedHash(result.text),recipe:result.recipe});
    }
    const {tips,invalid}=await this.received(id,h);
    if(invalid)throw Error("Shared publication metadata is damaged. Previous receipts are retained.");
    if(tips.length===1&&same(tips[0].pages,ordered)&&JSON.stringify(tips[0].results)===JSON.stringify(results))return;
    const createdAt=this.now();
    if(!Number.isSafeInteger(createdAt)||createdAt<0)throw Error("Invalid publication timestamp.");
    const p={version:2 as const,notebookId:id,textHash:h,pages:ordered,results,createdAt,supersedes:tips.map(r=>r.recordId).sort(lexical)};
    const recordId=await sharedHash(JSON.stringify(payload(p))),r:Receipt={...p,recordId},path=`${folder}/${recordId}.md`,body=envelope(r);
    const parts=folder.split("/");
    for(let n=1;n<=parts.length;n++){
      const dir=parts.slice(0,n).join("/");
      if(!await this.io.exists(dir))try{await this.io.mkdir(dir);}catch(e){if(!await this.io.exists(dir))throw e;}
    }
    try{await this.io.create(path,body);}catch(error){if(!await this.io.exists(path)||await this.io.read(path)!==body)throw error;}
  }
  async find(id:string,text:string):Promise<Receipt|undefined>{
    const {tips,invalid}=await this.received(id,await sharedHash(text));
    if(invalid||!tips.length)return;
    return tips.length===1?tips[0]:{...tips[0],candidates:tips};
  }
  /** Recovery can validate the owned pre-edit publication without possessing
   * its old Markdown. Damaged evidence must not become a missing receipt. */
  async findHash(id:string,textHash:string):Promise<Receipt|undefined>{
    const {tips,invalid}=await this.received(id,textHash);
    if(invalid)throw Error("Shared publication receipt is damaged. Recovery stopped.");
    if(!tips.length)return;
    return tips.length===1?tips[0]:{...tips[0],candidates:tips};
  }
}
/** Accept a complete observed inventory, including its order. Every concurrent
 * received tip must be compatible; clock timestamps cannot determine freshness.
 */
export function canAdvancePublication(receipt:Pick<Receipt,"pages"|"candidates">,current:PageDescriptor[],before:PageDescriptor[]):boolean{
  const candidates=receipt.candidates??[receipt];
  return candidates.length>0&&candidates.every(r=>same(r.pages,current)||same(r.pages,before));
}
/** An output may arrive before its immutable page results. Do not replace its
 * finished text with locally missing/stale text. New local replacements for a
 * stale displayed result are allowed once source inventory ownership is checked.
 */
export async function canAdoptPublication(receipt:Receipt,current:PageDescriptor[],local:NotebookState["pages"]):Promise<boolean>{
  const desired=new Map(current.map(p=>[p.id,p.fingerprint]));
  const hashes=new Map<string,Promise<string>>();
  for(const candidate of receipt.candidates??[receipt]){
    for(const result of candidate.results){
      // canAdvancePublication must separately validate a locally known deletion.
      if(!desired.has(result.id))continue;
      const known=local[result.id];if(!known)return false;
      if(known.fingerprint===desired.get(result.id)&&result.fingerprint!==desired.get(result.id))continue;
      if(known.fingerprint!==result.fingerprint||known.recipe!==result.recipe)return false;
      if(!hashes.has(result.id))hashes.set(result.id,sharedHash(known.text));
      if(await hashes.get(result.id)!==result.textHash)return false;
    }
  }
  return true;
}
