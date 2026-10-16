(async()=>{
 const real=app.plugins.plugins['nomad-transcripts'],before=window.__subscriptionBefore;
 if(!before)throw Error('Preservation baseline unavailable');
 const same=JSON.stringify(real.config)===before.config&&JSON.stringify(real.store)===before.store&&real.apiKey===before.key&&localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`)===before.costs&&real.aiEnabled===before.ai&&real.autoEnabled===before.auto;
 const outputs=(await Promise.all(before.outputs.map(async o=>(await app.vault.adapter.exists(o.path)?await app.vault.adapter.read(o.path):null)===o.text))).every(Boolean);
 if(!same||!outputs||real.task)throw Error('Production preservation check failed');
 delete window.__subscriptionBefore;
 return {productionConfigPreserved:true,cachePreserved:true,apiKeyPreserved:true,spendingRecordPreserved:true,outputsUnchanged:true,ai:real.aiEnabled,automatic:real.autoEnabled,paused:real.progress.paused,idle:true};
})();
