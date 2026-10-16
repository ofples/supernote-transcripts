import {Plugin,Modal,requestUrl} from 'obsidian';
import {AndroidReadOnlySource} from '../../src/reader';
import {begin,exchangeForm,identity,credentials,refreshForm,SECRET,ISSUER,RESOURCE} from './auth.mjs';
import {pageRequest,recognizeWithFallback} from '../subscription-probe/stream.mjs';

type RecordState={hostId:string;clientId?:string;subject?:string;email?:string;pending?:any;tokens?:any;testAttempted?:boolean;lastResult?:any};
export default class NomadSubscription extends Plugin {
 record!:RecordState;
 private modal?:TestModal;
 private finishing?:Promise<void>;
 private renewing?:Promise<void>;
 private working=false;
 status='Loading secure storage…';
 lastResult:any;
 private get secrets(){return (this.app as any).secretStorage;}
 async onload(){
  if(!this.secrets || !await this.secrets.isEncryptionAvailable())throw Error('Encrypted native storage is required');
  const saved=this.secrets.getSecret(SECRET);
  this.record=saved?JSON.parse(saved):{hostId:'urn:uuid:'+crypto.randomUUID()};
  this.lastResult=this.record.lastResult;
  this.status=this.record.tokens?'ChatGPT plan connected':this.record.pending?'Sign-in pending · finish in the browser':'Connect your ChatGPT plan';
  this.registerObsidianProtocolHandler('nomad-subscription-return',()=>{void this.finishSignIn();});
  const resume=()=>{if(this.record.pending)void this.finishSignIn();};
  this.registerDomEvent(window,'focus',resume);
  this.registerDomEvent(document,'visibilitychange',()=>{if(!document.hidden)resume();});
  this.addCommand({id:'open',name:'Open Nomad subscription test',callback:()=>this.open()});
  this.addRibbonIcon('notebook-pen','Nomad subscription test',()=>this.open());
  this.register(()=>this.modal?.close());
  this.persist();
 }
 private persist(){this.secrets.setSecret(SECRET,JSON.stringify(this.record));}
 private change(status:string){this.status=status;this.modal?.refresh();}
 open(){if(this.modal?.modalEl.isConnected)return;this.modal=new TestModal(this.app,this);this.modal.open();}
 private async native(url:string,method='GET',body?:string,headers:Record<string,string>={}){
  try{return await requestUrl({url,method,body,headers,throw:false});}catch{throw Error('Network request could not complete. No automatic retry.');}
 }
 private async discovery(){
  const r=await this.native(ISSUER+'/.well-known/openid-configuration');
  if(r.status!==200)throw Error('OpenAI discovery unavailable');
  const d=r.json;
  if(d.issuer!==ISSUER||!d.jwks_uri?.startsWith(ISSUER+'/')||!d.revocation_endpoint?.startsWith(ISSUER+'/'))throw Error('Invalid OpenAI discovery');
  return d;
 }
 async signIn(){
  if(this.working||this.finishing)return;
  if(this.record.pending && Date.now()-this.record.pending.created<600000){this.change('Sign-in is already open. Complete it in the browser, then tap Finish sign-in.');return;}
  try{
   // Retain the existing selected registration; this prototype connects one account.
   const auth=await begin(this.record);
   this.record.pending=auth.pending;this.persist();
   this.change('Continue in the Nomad browser. Approve a small allowance and disable credit use if offered.');
   window.open('supernote-login-helper://start?authorization='+encodeURIComponent(auth.url));
  }catch{this.change('Unable to start sign-in. Is the Supernote login helper installed?');}
 }
 async finishSignIn(){
  if(this.finishing)return this.finishing;
  if(!this.record.pending)return;
  this.finishing=this.completeSignIn().finally(()=>{this.finishing=undefined;});return this.finishing;
 }
 private async completeSignIn(){
  const pending=this.record.pending;
  try{
   const r=await this.native('http://127.0.0.1:19456/result','GET',undefined,{'X-Callback-State':pending.state});
   if(r.status===202)return;
   if(r.status!==200)throw Error('Sign-in return unavailable. Start a fresh sign-in.');
   const form=exchangeForm(pending,r.json);
   this.record.clientId=form.clientId;this.persist();
   this.change('Verifying ChatGPT plan permission…');
   const token=await this.native(ISSUER+'/api/accounts/oauth/token','POST',form.body,{'Content-Type':'application/x-www-form-urlencoded'});
   if(token.status!==200)throw Error('Code exchange failed. Start a fresh sign-in.');
   const d=await this.discovery(),keys=await this.native(d.jwks_uri);
   if(keys.status!==200)throw Error('Identity signing keys unavailable');
   const who=await identity(token.json.id_token,keys.json,form.clientId,pending.nonce,this.record.subject);
   const saved=credentials(token.json);
   this.record={...this.record,...who,tokens:saved,pending:undefined,testAttempted:false};
   this.persist();this.change('ChatGPT plan connected · this Nomad owns the session');
  }catch{this.record.pending=undefined;this.persist();this.change('Could not validate sign-in. Start a fresh attempt.');}
 }
 private async access(){
  if(!this.record.tokens)throw Error('Connect ChatGPT first');
  if(this.record.tokens.expiresAt>Date.now()+120000)return this.record.tokens.accessToken;
  if(!this.renewing)this.renewing=this.refreshSession().finally(()=>{this.renewing=undefined;});
  await this.renewing;return this.record.tokens.accessToken;
 }
 private async refreshSession(){
  if(this.record.tokens.earliestRefreshAt>Date.now())throw Error('Renewal is not yet allowed. Try again later.');
  const body=refreshForm(this.record);
  this.change('Renewing the ChatGPT session…');
  const r=await this.native(ISSUER+'/api/accounts/oauth/token','POST',body,{'Content-Type':'application/x-www-form-urlencoded'});
  if(r.status!==200)throw Error('Session renewal failed. Sign in again; no AI request was made.');
  const saved=credentials(r.json);
  // Replace the full rotating token set in one encrypted record before any inference.
  this.record.tokens=saved;this.persist();
 }
 async disconnect(){
  if(this.working||this.finishing)return;
  let revoked=true;
  if(this.record.tokens)try{
   const d=await this.discovery();
   const r=await this.native(d.revocation_endpoint,'POST',new URLSearchParams({token:this.record.tokens.refreshToken,token_type_hint:'refresh_token',client_id:this.record.clientId!}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});revoked=r.status===200;
  }catch{revoked=false;}
  this.record.tokens=undefined;this.record.pending=undefined;this.persist();
  this.change(revoked?'Disconnected':'Disconnected locally. Remote revocation was not confirmed; disconnect this app in ChatGPT Settings.');
 }
 async recognize(path:string,page:number){
  if(this.working||this.record.testAttempted)return;
  const real=(this.app as any).plugins.plugins['nomad-transcripts'];
  if(real?.task||!real?.progress.paused){this.change('Pause the normal transcription queue before this test.');return;}
  if(!path.startsWith('/storage/emulated/0/Note/')||!path.endsWith('.note')||!Number.isInteger(page)||page<1){this.change('Choose a valid notebook page.');return;}
  this.working=true;
  let notebook;
  try{
   const token=await this.access();
   const reader=new AndroidReadOnlySource((this.app.vault.adapter as any).fs,stage=>this.change(stage+'…'));
   notebook=await reader.open(path);const image=await notebook.render(page);
   if(await reader.revision(path)!==notebook.descriptor.revision)throw Error('Notebook changed before recognition');
   this.record.testAttempted=true;this.persist();
   const result=await recognizeWithFallback(async(model:string)=>{
    if(await reader.revision(path)!==notebook.descriptor.revision)throw Error('Notebook changed; stopped');
    this.change(`Recognizing one page · ${model}`);
    const r=await this.native(RESOURCE+'/responses','POST',JSON.stringify(pageRequest(model,image,'Transcribe handwriting faithfully, preserving headings and lists. Do not invent missing words, summarize, or add commentary.')),{'Authorization':'Bearer '+token,'Content-Type':'application/json'});
    let error;if(r.status!==200)try{error=r.json?.error;}catch{}
    return {status:r.status,text:r.text,error};
   });
   const changed=await reader.revision(path)!==notebook.descriptor.revision;
   this.lastResult={completed:true,model:result.model,text:result.output.text,usage:{input_tokens:result.output.usage?.input_tokens,output_tokens:result.output.usage?.output_tokens},attempts:result.attempts,changed,sourceWrites:0,transcriptWrites:0,desktopHelper:false};
   this.record.lastResult=this.lastResult;this.persist();
   this.change(`Completed · ${result.model} · ${this.lastResult.usage.input_tokens} input / ${this.lastResult.usage.output_tokens} output tokens`);
  }catch(e){this.change(e instanceof Error?e.message:'Recognition failed');this.lastResult={completed:false,error:this.status};}
  finally{notebook?.close();this.working=false;this.modal?.refresh();}
 }
 safeStatus(){return {connected:!!this.record.tokens,pending:!!this.record.pending,encryptedStorage:true,refreshAvailable:!!this.record.tokens?.refreshToken,testAttempted:!!this.record.testAttempted,status:this.status,lastResult:this.lastResult};}
}
class TestModal extends Modal{
 private status!:HTMLElement;
 private account!:HTMLElement;
 private result!:HTMLElement;
 private test!:HTMLButtonElement;
 private connect!:HTMLButtonElement;
 constructor(app:any,private p:NomadSubscription){super(app);}
 onOpen(){
  this.modalEl.addClass('st-subscription-probe');const c=this.contentEl;
  c.createEl('h1',{text:'Nomad subscription test'});
  this.account=c.createEl('p');this.status=c.createEl('p');
  this.connect=c.createEl('button',{text:'Continue with ChatGPT'});this.connect.onclick=()=>{void this.p.signIn();};
  c.createEl('button',{text:'Finish sign-in'}).onclick=()=>{void this.p.finishSignIn();};
  const label=c.createEl('label',{text:'Notebook'}),names=Object.keys((this.app as any).plugins.plugins['nomad-transcripts']?.store.notebooks??{});
  const path=label.createEl('input',{type:'text',value:names[0]??''});path.setAttribute('aria-label','Notebook path');
  const page=c.createEl('label',{text:'Page'}).createEl('input',{type:'number',value:'1'});page.min='1';page.setAttribute('aria-label','Page');
  this.test=c.createEl('button',{text:'Recognize one page'});this.test.onclick=()=>{void this.p.recognize(path.value,Number(page.value));};
  this.result=c.createEl('pre');
  c.createEl('p',{text:'One page per connection. No transcript or notebook writes. USB and the computer are not used for login, recognition or renewal.'});
  c.createEl('button',{text:'Disconnect ChatGPT'}).onclick=()=>{void this.p.disconnect();};
  this.refresh();
 }
 refresh(){if(!this.status?.isConnected)return;this.status.setText(this.p.status);this.account.setText(this.p.record.tokens?(this.p.record.email??'ChatGPT account'):'Not connected');this.test.disabled=!this.p.record.tokens||!!this.p.record.testAttempted;this.connect.disabled=!!this.p.record.tokens;this.result.setText(this.p.lastResult?.text??'');}
 onClose(){this.contentEl.empty();}
}
