(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];
 if(p.task||p.aiEnabled||p.autoEnabled)throw Error('Worker must be idle and AI off');
 window.__transcriptPolishBefore={config:JSON.stringify(p.config),store:JSON.stringify(p.store),key:p.apiKey,costs:localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`),outputs:await Promise.all(Object.values(p.store.notebooks).map(async n=>({path:n.output,text:await app.vault.adapter.read(n.output)})))};
 await app.plugins.unloadPlugin('nomad-transcripts-ui-fixture');
 await app.plugins.unloadPlugin('nomad-transcripts');
 return {idle:true,ai:false,auto:false,backupCaptured:true,fixtureUnloaded:true};
})();
