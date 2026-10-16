import type { RequestTarget } from "./cost";
import { BudgetBlocked } from "./cost";
type Entry = { targets?: RequestTarget[]; completedPages?:number; id: string; source: string; model: string; recipe: string; day: string; status: "pending" | "complete" | "failed" | "unconfirmed" | "counted"; started: number; seconds?: number; input?: number; output?: number; pageId?: string; pageNumber?: number; fingerprint?:string; recoveryAcknowledged?:boolean };
export class SubscriptionUsage {
  private entries: Entry[] = [];
  private broken = false;
  constructor(private storage: Pick<Storage,"getItem"|"setItem">,private key:string) {
    try {
      const raw=storage.getItem(key);
      if(raw!==null){
        const parsed=JSON.parse(raw);
        const seen=new Set<string>();
        if(!Array.isArray(parsed)||parsed.some(e=>{
          if(!e||typeof e.id!=="string"||!e.id||seen.has(e.id)||
             ![e.source,e.model,e.recipe].every(v=>typeof v==="string"&&!!v)||
             typeof e.day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(e.day)||
             !["pending","complete","failed","unconfirmed","counted"].includes(e.status)||
             !Number.isSafeInteger(e.started)||e.started<0||e.started>Date.now()+300000||
             e.day!==new Date(e.started).toISOString().slice(0,10)||
             (e.seconds!==undefined&&(!Number.isFinite(e.seconds)||e.seconds<0))||
             [e.input,e.output].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||
             (e.targets!==undefined&&(!Array.isArray(e.targets)||!e.targets.length||e.targets.some((t:RequestTarget)=>!t||typeof t.pageId!=="string"||!t.pageId||typeof t.fingerprint!=="string"||!t.fingerprint||!Number.isSafeInteger(t.page)||t.page<1||(t.recoveryAcknowledged!==undefined&&typeof t.recoveryAcknowledged!=="boolean"))||new Set(e.targets.map((t:RequestTarget)=>t.pageId)).size!==e.targets.length))||
             (e.completedPages!==undefined&&(!Number.isSafeInteger(e.completedPages)||e.completedPages<0||e.completedPages>(e.targets?.length??1)))||
             (e.pageId!==undefined&&(typeof e.pageId!=="string"||!e.pageId))||
             (e.fingerprint!==undefined&&(typeof e.fingerprint!=="string"||!e.fingerprint))||
             (e.recoveryAcknowledged!==undefined&&typeof e.recoveryAcknowledged!=="boolean")||
             (e.pageNumber!==undefined&&(!Number.isSafeInteger(e.pageNumber)||e.pageNumber<1)))return true;
          seen.add(e.id);return false;
        })||!["input","output"].every(k=>Number.isSafeInteger(parsed.reduce((n,e)=>n+(e[k]??0),0))))throw Error("Invalid usage record");
        this.entries=parsed;
        for(const e of this.entries)if(e.status==="pending")e.status="unconfirmed";
        this.write();
      }
    }catch{this.broken=true;}
  }
  private write(){try{this.storage.setItem(this.key,JSON.stringify(this.entries));}catch{this.broken=true;throw new BudgetBlocked("ChatGPT request usage could not be saved. Recognition stopped.");}}
  reserve(source:string,model:string,recipe:string,limit:number,pageId?:string,pageNumber?:number,fingerprint?:string,targets?:RequestTarget[]){
    if(this.broken)throw new BudgetBlocked("ChatGPT usage record is unreadable. Restore it before continuing.");
    if(![source,model,recipe].every(v=>typeof v==="string"&&!!v))throw new BudgetBlocked("ChatGPT request identity is incomplete.");
    const day=new Date().toISOString().slice(0,10);
    if(!Number.isInteger(limit)||limit<1||this.entries.filter(e=>e.day===day).length>=limit)throw new BudgetBlocked("Daily ChatGPT request limit reached.");
    if((pageId!==undefined&&(typeof pageId!=="string"||!pageId))||(pageNumber!==undefined&&(!Number.isSafeInteger(pageNumber)||pageNumber<1))||(fingerprint!==undefined&&(typeof fingerprint!=="string"||!fingerprint)))throw new BudgetBlocked("ChatGPT page identity is invalid.");
    if(targets&&(!targets.length||targets.some(t=>typeof t.pageId!=="string"||!t.pageId||typeof t.fingerprint!=="string"||!t.fingerprint||!Number.isSafeInteger(t.page)||t.page<1)||new Set(targets.map(t=>t.pageId)).size!==targets.length))throw new BudgetBlocked("ChatGPT request targets are invalid.");
    const entry:Entry={id:crypto.randomUUID(),source,model,recipe,day,status:"pending",started:Date.now(),pageId,pageNumber,fingerprint,...(targets?{targets:JSON.parse(JSON.stringify(targets))}:{})};
    this.entries.push(entry);this.write();return entry.id;
  }
  finish(id:string,result?:{usage?:any},success=true,completedPages?:number){
    if(this.broken)throw new BudgetBlocked("ChatGPT usage record is unreadable. Restore it before continuing.");
    const e=this.entries.find(e=>e.id===id);
    if(!e||e.status!=="pending")throw new BudgetBlocked("ChatGPT request reservation is missing or already settled.");
    if(completedPages!==undefined&&(!Number.isSafeInteger(completedPages)||completedPages<0||completedPages>(e.targets?.length??1)))throw new BudgetBlocked("Completed page count is invalid.");
    e.completedPages=completedPages??(result&&success?(e.targets?.length??1):0);
    e.status=result?(success?"complete":"failed"):"unconfirmed";e.seconds=Math.max(0,(Date.now()-e.started)/1000);
    const input=result?.usage?.input_tokens,output=result?.usage?.output_tokens;
    if(Number.isSafeInteger(input)&&input>=0)e.input=input;
    if(Number.isSafeInteger(output)&&output>=0)e.output=output;
    this.write();
  }
  resolve(){if(this.broken)throw new BudgetBlocked("Restore the ChatGPT usage record before continuing.");for(const e of this.entries)if(e.status==="unconfirmed")e.status="counted";this.write();}
  recoverableAttempts(){if(this.broken)throw new BudgetBlocked("Restore the ChatGPT usage record before continuing.");return this.entries.flatMap(e=>(e.targets??[{pageId:e.pageId,fingerprint:e.fingerprint,recoveryAcknowledged:e.recoveryAcknowledged}]).map(t=>({id:e.id,source:e.source,pageId:t.pageId,fingerprint:t.fingerprint,recipe:e.recipe,status:e.status,started:e.started,acknowledged:t.recoveryAcknowledged===true})));}
  acknowledgeRecovery(source:string,pageId?:string,fingerprint?:string){if(this.broken)throw new BudgetBlocked("Restore the ChatGPT usage record before continuing.");let changed=false;for(const e of this.entries)if(e.source===source&&e.targets)for(const t of e.targets)if((pageId===undefined||(t.pageId===pageId&&t.fingerprint===fingerprint))&&!t.recoveryAcknowledged){t.recoveryAcknowledged=true;changed=true;}for(const e of this.entries)if(e.source===source&&(pageId===undefined||(e.pageId===pageId&&e.fingerprint===fingerprint))&&!e.recoveryAcknowledged){e.recoveryAcknowledged=true;changed=true;}if(changed)this.write();}
  snapshot(){const aggregate=(rows:Entry[])=>({requests:rows.length,pages:rows.reduce((n,e)=>n+(e.completedPages??(e.status==="complete"?1:0)),0),inputTokens:rows.reduce((n,e)=>n+(e.input??0),0),outputTokens:rows.reduce((n,e)=>n+(e.output??0),0)});const bySource=[...new Set(this.entries.map(e=>JSON.stringify([e.source,e.model])))].map(key=>{const [source,model]=JSON.parse(key);return {source,model,...aggregate(this.entries.filter(e=>e.source===source&&e.model===model))};});const day=new Date().toISOString().slice(0,10);return {bySource,requests:this.entries.length,pages:this.entries.reduce((n,e)=>n+(e.completedPages??(e.status==="complete"?1:0)),0),inputTokens:this.entries.reduce((n,e)=>n+(e.input??0),0),outputTokens:this.entries.reduce((n,e)=>n+(e.output??0),0),unconfirmed:this.entries.filter(e=>e.status==="unconfirmed").length,todayRequests:this.entries.filter(e=>e.day===day).length,day};}
  average(model:string,recipe?:string){const rows=this.entries.filter(e=>e.status==="complete"&&e.model===model&&(!recipe||e.recipe===recipe)).slice(-20);const pages=rows.reduce((n,e)=>n+(e.completedPages??1),0);return {samples:pages,seconds:pages?rows.reduce((n,e)=>n+(e.seconds??0),0)/pages:undefined};}
}
