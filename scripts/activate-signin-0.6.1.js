(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];if(!p||p.task||!p.progress.paused||document.querySelector('.modal-container'))throw Error('Preserve open work and forms');
 const prefix=`nomad-transcripts:${app.vault.getName()}`;
 const before={config:JSON.stringify(p.config),store:JSON.stringify(p.store),key:p.apiKey,session:JSON.stringify(p.chatGPT.record),costs:localStorage.getItem(prefix+':spending-v1'),usage:localStorage.getItem(prefix+':subscription-usage-v1'),provider:p.provider,ai:p.aiEnabled,auto:p.autoEnabled};
 window.__signinPatchBefore=before;
 await app.plugins.unloadPlugin('nomad-transcripts');await app.plugins.loadManifests();await app.plugins.loadPlugin('nomad-transcripts');
 const next=app.plugins.plugins['nomad-transcripts'];await next.chatGPT.initialize();
 const preserved={config:JSON.stringify(next.config)===before.config,cache:JSON.stringify(next.store)===before.store,key:next.apiKey===before.key,session:JSON.stringify(next.chatGPT.record)===before.session,costs:localStorage.getItem(prefix+':spending-v1')===before.costs,usage:localStorage.getItem(prefix+':subscription-usage-v1')===before.usage,provider:next.provider===before.provider,ai:next.aiEnabled===before.ai,auto:next.autoEnabled===before.auto};
 if(Object.values(preserved).some(v=>!v))throw Error('Preservation failed: '+JSON.stringify(preserved));
 if(next.manifest.version!=='0.6.1'||next.initializing||next.task||!next.progress.paused||!next.subscriptionStatus.connected)throw Error('Unexpected activation state');
 return {version:next.manifest.version,initialized:true,connected:next.subscriptionStatus.connected,provider:next.provider,idle:!next.task,paused:next.progress.paused,preserved,recognitionRequests:0};
})();
