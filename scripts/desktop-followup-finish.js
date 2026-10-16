(async()=>{
 if(document.querySelector('.modal-container'))throw Error('Preserve the open form');
 // Finish setup on the already loaded plugin; no reload or worker start.
 const p=app.plugins.plugins['nomad-transcripts'],before=window.__desktopFollowupBefore;
 if(!p||p.manifest.version!=='0.6.0'||!before||p.task||!p.progress.paused)throw Error('Activation state is not safe');
 if(p.apiKey!==before.key||p.aiEnabled!==before.ai||p.autoEnabled!==before.auto||JSON.stringify(p.store)!==before.store||localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`)!==before.costs)throw Error('Preservation check failed');
 const priorConfig=JSON.parse(before.config);
 for(const rule of priorConfig.rules){const current=p.config.rules.find(r=>r.id===rule.id);if(JSON.stringify(current)!==JSON.stringify(rule))throw Error('Original source configuration changed unexpectedly');}
 const outputs=(await Promise.all(before.outputs.map(async o=>(await app.vault.adapter.exists(o.path)?await app.vault.adapter.read(o.path):null)===o.text))).every(Boolean);
 if(!outputs)throw Error('Original transcript changed unexpectedly');
 const names=await app.vault.adapter.fs.readdir('/storage/emulated/0/Note/Satsang');
 const excluded=names.map(f=>typeof f==='string'?f:f.name).filter(n=>n.toLowerCase().endsWith('.note')&&!/^2610(?:\s|[-_.])/i.test(n)).sort();
 let satsang=p.config.rules.find(r=>r.source==='/storage/emulated/0/Note/Satsang');
 if(!satsang){satsang={id:'satsang',sharedId:'satsang',enabled:true,source:'/storage/emulated/0/Note/Satsang',output:'Supernote Transcripts/Transcripts/Satsang',recursive:true,exclude:excluded,profileId:p.config.rules[0]?.profileId??'general'};p.config.rules.push(satsang);}
 else satsang.exclude=[...new Set([...satsang.exclude,...excluded])];
 await p.saveConfig();
 const sharedResults=await p.exportSavedResults();
 return {version:p.manifest.version,paused:p.progress.paused,idle:!p.task,ai:p.aiEnabled,automatic:p.autoEnabled,cachePreserved:true,keyPreserved:true,costsPreserved:localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`)===before.costs,outputsPreserved:outputs,olderSatsangExcluded:excluded.length,satsangIncluded:names.map(f=>typeof f==='string'?f:f.name).filter(n=>/^2610(?:\s|[-_.])/i.test(n)),sharedResultsExported:sharedResults,concurrency:p.concurrency,provider:p.provider};
})();

