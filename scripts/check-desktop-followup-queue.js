(async()=>{
 const c=window.__transcriptUIFixture,root=document.querySelector('.st-fullscreen-modal');if(!c||!root)throw Error('Require isolated fixture');
 const source=Object.keys(c.store.notebooks).find(s=>c.sourceSelected(s));const state=c.store.notebooks[source];
 c.aiEnabled=true;c.progress.running=true;c.progress.stage='Recognizing';c.progress.activeSource=source;c.progress.activePage={source,number:37,total:79};c.progress.activePages=[37,38,39,40];state.status='recognizing';delete state.error;
 if(!c.store.queue.some(t=>t.source===source))c.store.queue.push({source});
 await c.saveConfig();root.querySelector('[aria-label="Open queue"]').click();
 const modal=document.querySelector('.st-fullscreen-modal');const text=modal.innerText;
 const tests={estimate:text.includes('$0.09'),activeRequests:text.includes('4 simultaneous requests'),activePages:text.includes('37, 38, 39, 40'),bars:modal.querySelectorAll('[role="progressbar"]').length,overflow:modal.scrollWidth>modal.clientWidth,realIdle:!app.plugins.plugins['nomad-transcripts'].task,realPaused:app.plugins.plugins['nomad-transcripts'].progress.paused};
 if(!tests.estimate||!tests.activeRequests||!tests.activePages||!tests.bars||tests.overflow)throw Error(JSON.stringify(tests));return tests;
})();
