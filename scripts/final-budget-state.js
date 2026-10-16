(()=>{
 delete window.__transcriptFolderReadOnly;
 delete window.TranscriptFolderCheck;
 const p=app.plugins.plugins['nomad-transcripts'];
 if(p.task||p.aiEnabled||p.autoEnabled||app.plugins.plugins['nomad-transcripts-ui-fixture']||document.querySelector('.st-fullscreen-modal'))throw Error('Device not released safely');
 const persisted=JSON.parse(localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`));
 return {version:p.manifest.version,idle:true,ai:false,automatic:false,fixtureUnloaded:true,panelsClosed:true,costRecordSaved:!!persisted,recordedRequests:persisted.entries.length,budget:persisted.settings.dailyUsd+'/'+persisted.settings.monthlyUsd+'/'+persisted.settings.runUsd,cache:Object.values(p.store.notebooks).map(s=>({pagesSaved:Object.keys(s.pages).length,pagesDesired:s.desired.length})),output:p.config.rules.find(r=>r.enabled)?.output};
})();
