(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];
 const root=document.querySelector('.st-fullscreen-modal');
 if(p.task || p.autoEnabled || (root && root.querySelector('h1')?.innerText!=='Mirrors')) throw Error('Preserve active work or a form');
 p.aiEnabled=false;
 root?.querySelector('.st-close')?.click();
 return {idle:!p.task,ai:p.aiEnabled,automatic:p.autoEnabled,forms:document.querySelectorAll('.modal-container').length};
})();
