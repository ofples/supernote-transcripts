(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];if(!p)throw Error('Plugin unavailable');
 p.pause();await p.chatGPT.initialize();
 const modals=[...document.querySelectorAll('.modal-container')].map(e=>({classes:e.className,title:e.querySelector('h1,h2,.modal-title')?.textContent}));
 return {version:p.manifest.version,idle:!p.task,paused:p.progress.paused,connected:p.subscriptionStatus.connected,provider:p.provider,modals,
  failures:Object.values(p.store.notebooks).filter(s=>s.error).map(s=>({name:s.source.split('/').pop(),status:s.status,error:s.error})),
  testEnabled:!!app.plugins.plugins['nomad-subscription-test']};
})();
