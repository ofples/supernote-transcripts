(async()=>{
 if(document.querySelector('.modal-container'))throw Error('Preserve open forms');await app.plugins.loadManifests();await app.plugins.loadPlugin('nomad-transcripts');const p=app.plugins.plugins['nomad-transcripts'];
 if(!p||p.initializing||p.task||!p.progress.paused)throw Error('Require initialized idle paused plugin');await p.saveConfig();
 const b=window.__desktopFollowupBefore;const outputs=(await Promise.all(b.outputs.map(async o=>(await app.vault.adapter.exists(o.path)?await app.vault.adapter.read(o.path):null)===o.text))).every(Boolean);
 const preserved={key:p.apiKey===b.key,cache:JSON.stringify(p.store)===b.store,costs:localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`)===b.costs,ai:p.aiEnabled===b.ai,auto:p.autoEnabled===b.auto,outputs};if(Object.values(preserved).some(v=>!v))throw Error('Preservation failed '+JSON.stringify(preserved));
 return {version:p.manifest.version,initialized:!p.initializing,paused:p.progress.paused,idle:!p.task,preserved,commands:Object.keys(app.commands.commands).filter(k=>k.startsWith('nomad-transcripts:')),rules:p.config.rules.map(r=>({id:r.id,sharedId:r.sharedId,profileId:r.profileId,exclusions:r.exclude.length}))};
})();
