(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];if(p.task||!p.progress.paused||document.querySelector('.modal-container'))throw Error('Preserve active work');
 await app.plugins.unloadPlugin('nomad-transcripts');
 await app.plugins.loadPlugin('nomad-transcripts');
 const loaded=app.plugins.plugins['nomad-transcripts'];
 if(!loaded||loaded.initializing)throw Error('Plugin initialization incomplete');
 await loaded.saveConfig();
 return {version:loaded.manifest.version,initialized:!loaded.initializing,idle:!loaded.task,paused:loaded.progress.paused,rules:loaded.config.rules.map(r=>({id:r.id,sharedId:r.sharedId,exclude:r.exclude.length})),commands:Object.keys(app.commands.commands).filter(k=>k.startsWith('nomad-transcripts:'))};
})();
