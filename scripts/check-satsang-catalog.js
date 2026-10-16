(async()=>{
 const c=window.__transcriptUIFixture;
 const rule={...c.config.rules[0],source:'/storage/emulated/0/Note/Satsang',recursive:true,exclude:[]};
 const choices=await c.listNotebookChoices(rule,true);
 return {notebooks:choices.length,withExistingTranscripts:choices.filter(x=>x.existingTranscripts.length).length,candidates:choices.filter(x=>x.existingTranscripts.length).slice(0,3).map(x=>({notebook:x.relative,transcripts:x.existingTranscripts})),aiRequests:0,filesWritten:0};
})();
