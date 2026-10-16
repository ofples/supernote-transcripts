(async()=>{
 const id='nomad-transcripts',old=app.plugins.plugins[id];
 if(old.task)throw Error('Preserve the active request before upgrading');
 await app.plugins.unloadPlugin('nomad-transcripts-ui-fixture');
 localStorage.setItem(`nomad-transcripts:${app.vault.getName()}:ai`,'false');
 old.autoEnabled=false;old.pause();
 await app.plugins.unloadPlugin(id);await app.plugins.loadManifests();await app.plugins.loadPlugin(id);
 const p=app.plugins.plugins[id],path='/storage/emulated/0/Note/Reflections/2610 - Reflection.note';
 const before=await app.vault.adapter.read(p.store.notebooks[path].output);
 await p.manual(path,'1-4');p.pause();
 const after=await app.vault.adapter.read(p.store.notebooks[path].output);
 app.commands.executeCommandById(`${id}:open`);
 return {version:p.manifest.version,aiEnabled:p.aiEnabled,automatic:p.autoEnabled,calls:p.callsThisRun,ready:p.store.notebooks[path].desired.filter(d=>p.store.notebooks[path].pages[d.id]?.fingerprint===d.fingerprint).length,total:p.store.notebooks[path].desired.length,reused:p.progress.reused,outputUnchanged:before===after,fixtureUnloaded:!app.plugins.plugins['nomad-transcripts-ui-fixture'],body:document.querySelector('.st-fullscreen-modal')?.innerText};
})();
