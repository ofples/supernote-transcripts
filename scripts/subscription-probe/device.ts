import {Plugin, Modal, requestUrl} from 'obsidian';
import {AndroidReadOnlySource} from '../../src/reader';
import {pageRequest, catalogModels, recognizeWithFallback} from './stream.mjs';

const MODEL='gpt-6.1-sol';
const BRIDGE='http://127.0.0.1:19455';
export default class SubscriptionProbe extends Plugin {
  private secret='';
  private modal?: ProbeModal;
  // Transient USB bridge credential, delivered in memory by the local test runner.
  connectBridge(secret:string) { this.secret=secret; }
  async bridge(path:string,method='GET') {
    if(!this.secret)throw Error('Connect the temporary USB helper first');
    const result=await requestUrl({url:BRIDGE+path,method,headers:{'X-Probe-Secret':this.secret},throw:false});
    if(result.status!==200)throw Error(result.json?.error || 'USB helper unavailable');
    return result.json;
  }
  onload() {
    this.addCommand({id:'open',name:'Open isolated subscription test',callback:()=>this.open()});
    this.register(()=>{this.secret='';this.modal?.close();});
  }
  open() {
    if(this.modal?.modalEl.isConnected)return;
    this.modal=new ProbeModal(this.app,this);this.modal.open();
  }
}
class ProbeModal extends Modal {
  private status!:HTMLElement;
  private result!:HTMLElement;
  private run!:HTMLButtonElement;
  private used=false;
  private closed=false;
  private accessToken='';
  constructor(app:any,private probe:SubscriptionProbe){super(app);}
  onOpen() {
    this.modalEl.addClass('st-subscription-probe');
    const c=this.contentEl;c.createEl('h1',{text:'ChatGPT subscription test'});
    c.createEl('p',{text:'Isolated test · one page · no API-key fallback · no transcript writes'});
    this.status=c.createEl('p',{text:'Checking USB helper…'});
    const real=(this.app as any).plugins.plugins['nomad-transcripts'];
    const names=Object.keys(real?.store.notebooks ?? {});
    const source=c.createEl('label',{text:'Notebook path'});
    const input=source.createEl('input',{type:'text',value:names[0] ?? ''});input.setAttribute('aria-label','Notebook path');
    const pageLabel=c.createEl('label',{text:'Page'});
    const page=pageLabel.createEl('input',{type:'number',value:'1'});page.min='1';page.setAttribute('aria-label','Page');
    this.run=c.createEl('button',{text:'Test one page'});this.run.disabled=true;
    this.run.onclick=()=>{void this.recognize(input.value,Number(page.value)).catch(()=>this.status.setText('Choose a valid notebook path and page number.'));};
    this.result=c.createEl('pre',{text:''});
    c.createEl('p',{text:'Login was assisted by the computer over USB. This does not yet establish independent login or operation after unplugging.'});
    void this.probe.bridge('/status').then(s=>{
      if(this.closed)return;this.status.setText(s.connected?'ChatGPT plan permission verified. Ready for one page.':s.state);
      this.run.disabled=!s.connected||s.leased;
    }).catch(()=>{if(!this.closed)this.status.setText('USB helper unavailable. No recognition request was made.');});
  }
  async recognize(path:string,page:number) {
    if(this.used||this.closed)return;
    if(!path.startsWith('/storage/emulated/0/Note/')||!path.endsWith('.note')||!Number.isInteger(page)||page<1)throw Error('Choose one valid local notebook page');
    const real=(this.app as any).plugins.plugins['nomad-transcripts'];
    if(real?.task) {this.status.setText('Wait until the normal transcript worker is idle.');return;}
    this.used=true;this.run.disabled=true;
    let notebook;
    try {
      const fs=(this.app.vault.adapter as any).fs;
      const reader=new AndroidReadOnlySource(fs,(stage)=>{if(!this.closed)this.status.setText(stage+'…');});
      notebook=await reader.open(path);
      const image=await notebook.render(page);
      if(this.closed)return;
      const lease=await this.probe.bridge('/lease','POST');this.accessToken=lease.accessToken;
      const headers={Authorization:`Bearer ${this.accessToken}`};
      this.status.setText('Checking models available to your ChatGPT plan…');
      const catalog=await requestUrl({url:'https://api.openai.com/v1/models',headers,throw:false});
      if(catalog.status!==200)throw Error(`Subscription model discovery failed (HTTP ${catalog.status})`);
      const choices=catalogModels(catalog.json);
      (this.probe as any).lastCatalog={keys:Object.keys(catalog.json),models:choices};
      if(this.closed)return;
      if(await reader.revision(path)!==notebook.descriptor.revision)throw Error('Notebook changed. No recognition request was made.');
      const recognized=await recognizeWithFallback(async(model:string)=>{
        if(this.closed)throw Error('Test closed');
        if(model!==MODEL && !choices.some((m:any)=>m.slug===model))throw Error('The fallback model is absent from this subscription catalog');
        if(await reader.revision(path)!==notebook.descriptor.revision)throw Error('Notebook changed; test stopped');
        this.status.setText(`Recognizing one page with ${model}…`);
        const body=pageRequest(model,image,'Transcribe handwriting faithfully, preserving headings and lists. Do not invent missing words, summarize, or add commentary.');
        const response=await requestUrl({url:'https://api.openai.com/v1/responses',method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),throw:false});
        let error; if(response.status!==200)try{error=response.json?.error;}catch{}
        return {status:response.status,text:response.text,error};
      });
      const {output,model,attempts}=recognized;
      const changed=await reader.revision(path)!==notebook.descriptor.revision;
      if(!this.closed) {
        this.result.setText(output.text);
        this.status.setText(`Subscription test completed · ${model} · ${output.usage?.input_tokens ?? '?'} input / ${output.usage?.output_tokens ?? '?'} output tokens${changed?' · source changed during the request':''}. Result is temporary; no transcript was saved.`);
      }
      // Safe diagnostics retain only output text/token counts, never credentials.
      (this.probe as any).lastResult={completed:true,model,text:output.text,usage:output.usage,changed,requests:attempts.length,attempts,sourceWrites:0,transcriptWrites:0,apiFallback:false};
    } catch(e) {
      const message=e instanceof Error?e.message:'Test failed';
      if(!this.closed)this.status.setText(message);
      (this.probe as any).lastResult={completed:false,error:message,apiFallback:false};
    } finally {this.accessToken='';notebook?.close();}
  }
  onClose(){this.closed=true;this.accessToken='';this.contentEl.empty();}
}
