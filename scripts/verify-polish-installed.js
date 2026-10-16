(async()=>{
 await app.plugins.loadManifests();await app.plugins.loadPlugin('nomad-transcripts');
 const p=app.plugins.plugins['nomad-transcripts'],before=window.__transcriptPolishBefore;
 const sameOutputs=(await Promise.all(before.outputs.map(async o=>(await app.vault.adapter.read(o.path))===o.text))).every(Boolean);
 const expectedConfig=JSON.parse(before.config);if(expectedConfig.continuous===undefined)expectedConfig.continuous=true;
 if(JSON.stringify(p.config)!==JSON.stringify(expectedConfig)||JSON.stringify(p.store)!==before.store||p.apiKey!==before.key||!sameOutputs||localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`)!==before.costs||p.aiEnabled||p.autoEnabled||p.task)throw Error('Preservation check failed');
 delete window.__transcriptPolishBefore;

 app.commands.executeCommandById('nomad-transcripts:open');
 app.commands.executeCommandById('nomad-transcripts:open');
 const root=document.querySelector('.st-fullscreen-modal');
 return {version:p.manifest.version,configPreserved:true,cachePreserved:true,costLedgerPreserved:true,keyPreserved:true,markdownUnchanged:sameOutputs,ai:false,automatic:false,idle:true,continuous:p.config.continuous,budget:p.costs.settings,costRequests:p.costs.total.requests,recognizedThisSession:p.progress.recognized,modalCount:document.querySelectorAll('.st-fullscreen-modal').length,closeButtons:root.querySelectorAll('.st-close').length,nativeCloseButtons:root.querySelectorAll('.modal-close-button,.modal-header-button').length,body:root.innerText};
})();
