(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];if(!p||p.manifest.version!=='0.6.4'||p.task||p.initializing||!p.progress.paused||!p.subscriptionStatus.connected)throw Error('Expected production 0.6.4 connected, idle and paused');
 const docs=[document];if(globalThis.activeDocument&&globalThis.activeDocument!==document)docs.push(globalThis.activeDocument);
 if(docs.some(d=>d.querySelector('.modal-container')))throw Error('Preserve existing forms before the mock fixture');
 const prefix=`nomad-transcripts:${app.vault.getName()}`,hash=async value=>{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')};
 const outputs=[];for(const state of Object.values(p.store.notebooks)){if(!state.output||outputs.some(x=>x.path===state.output))continue;const text=await app.vault.adapter.exists(state.output)?await app.vault.adapter.read(state.output):null;outputs.push({path:state.output,hash:text===null?null:await hash(text)});}outputs.sort((a,b)=>a.path.localeCompare(b.path));
 const payload=JSON.stringify({config:p.config,store:p.store,apiKey:p.apiKey,chatGPTRecord:p.chatGPT?.record,subscriptionRecord:p.subscription?.record,provider:p.provider,aiEnabled:p.aiEnabled,autoEnabled:p.autoEnabled,concurrency:p.concurrency,progressPaused:p.progress.paused,progressRecognized:p.progress.recognized,costs:localStorage.getItem(`${prefix}:spending-v1`),usage:localStorage.getItem(`${prefix}:subscription-usage-v1`)});
 globalThis.__inlineBrowserFixtureBaseline={payload,outputs,version:p.manifest.version,platform:p.platform,requests:p.subscriptionUsage?.requests??null,usagePages:p.subscriptionUsage?.pages??null};
 return {captured:true,version:p.manifest.version,platform:p.platform,connected:true,idle:true,paused:true,forms:0,managedOutputs:outputs.length,recognitionCount:p.progress.recognized};
})();
