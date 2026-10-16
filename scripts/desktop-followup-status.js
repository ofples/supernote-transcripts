(()=>{
 const p=app.plugins.plugins['nomad-transcripts'];
 return {version:p?.manifest.version,configDir:app.vault.configDir,vault:app.vault.getName(),idle:!p?.task,paused:p?.progress.paused,ai:p?.aiEnabled,automatic:p?.autoEnabled,modal:!!document.querySelector('.modal-container'),rules:p?.config.rules.map(r=>({id:r.id,source:r.source,output:r.output,exclude:r.exclude,profileId:r.profileId})),subscriptionTest:!!app.plugins.plugins['nomad-subscription-test']};
})();
