(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];
 if(!p)throw Error('Production plugin is not loaded');
 const fs=app.vault.adapter.fs;
 const inventory=await fs.readdir('/storage/emulated/0/Note/Satsang');
 return {version:p.manifest.version,configDir:app.vault.configDir,vault:app.vault.getName(),idle:!p.task,paused:p.progress.paused,ai:p.aiEnabled,automatic:p.autoEnabled,modal:!!document.querySelector('.modal-container'),rules:p.config.rules.map(r=>({id:r.id,source:r.source,output:r.output,exclude:r.exclude,profileId:r.profileId})),satsang:inventory.map(f=>typeof f==='string'?f:f.name),subscriptionTest:!!app.plugins.plugins['nomad-subscription-test'],secureStorage:!!app.secretStorage&&await app.secretStorage.isEncryptionAvailable()};
})();
