(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];
 window.__redesignAuto=p.autoEnabled;
 p.autoEnabled=false;
 if(p.task) await p.task;
 return {version:p.manifest.version,progress:p.progress,queue:p.store.queue,lastChecked:p.store.lastChecked,autoWas:window.__redesignAuto,notebooks:Object.values(p.store.notebooks).map(s=>({source:s.source,status:s.status,total:s.desired.length,ready:s.desired.filter(d=>s.pages[d.id]?.fingerprint===d.fingerprint).length,cached:Object.values(s.pages).map(v=>v.number).sort((a,b)=>a-b),force:s.forcePending,error:s.error,revision:s.revision,lastSaved:s.lastSaved})),sourceStat:await app.vault.adapter.fs.stat('/storage/emulated/0/Note/Reflections/2610 - Reflection.note')};
})();
