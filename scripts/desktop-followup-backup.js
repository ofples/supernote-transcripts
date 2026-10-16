(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];
 if(p.task||!p.progress.paused||document.querySelector('.modal-container'))throw Error('Require the idle paused worker and preserve any open form');
 window.__desktopFollowupBefore={config:JSON.stringify(p.config),store:JSON.stringify(p.store),key:p.apiKey,costs:localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`),ai:p.aiEnabled,auto:p.autoEnabled,outputs:await Promise.all(Object.values(p.store.notebooks).filter(n=>n.output).map(async n=>({path:n.output,text:await app.vault.adapter.exists(n.output)?await app.vault.adapter.read(n.output):null})))};
 await app.plugins.unloadPlugin('nomad-transcripts');
 return {backupCaptured:true,pluginUnloaded:true,paidRequests:0};
})();
