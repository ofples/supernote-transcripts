(async()=>{
 const p=app.plugins.plugins["nomad-transcripts"],s=globalThis.__nomadFolderFixtureSource,fs=app.vault.adapter.fs;
 const slash=String(s).replace(/\\/g,"/"),parent=slash.slice(0,slash.lastIndexOf("/")),base=slash.split("/").pop();
 let parentEntries=[],parentType="unknown",sourceType="unknown";
 try{parentType=(await fs.stat(parent)).type;parentEntries=await fs.readdir(parent)}catch(e){parentType=String(e?.name||"Error")}
 try{sourceType=(await fs.stat(slash)).type}catch(e){sourceType=String(e?.name||"Error")}
 const children=sourceType==="directory"?await fs.readdir(slash).catch(()=>[]):[];
 return {sourceKnown:!!s,rootPrefix:slash.startsWith("/storage/emulated/0/Note/"),relativeDepth:slash.slice("/storage/emulated/0/Note/".length).split("/").filter(Boolean).length,parentReadable:Array.isArray(parentEntries),parentType,configuredFolderListed:parentEntries.some(x=>(typeof x==="string"?x:x?.name)===base),sourceType,childEntries:children.length,childNotebookCount:children.filter(x=>String(typeof x==="string"?x:x?.name).toLowerCase().endsWith(".note")).length,productionPaused:!!p.progress.paused,idle:!p.task,fixtureRules:window.__transcriptUIFixture?.config.rules.length};
})()