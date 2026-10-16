(async()=>{
 const real=app.plugins.plugins['nomad-transcripts'];
 if(real.task || !real.progress.paused)throw Error('Normal worker must be idle and paused');
 const root=document.querySelector('.st-fullscreen-modal');
 if(root && !['Mirrors','Queue'].includes(root.querySelector('h1')?.textContent))throw Error('Preserve the open form');
 window.__subscriptionBefore={config:JSON.stringify(real.config),store:JSON.stringify(real.store),key:real.apiKey,costs:localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`),ai:real.aiEnabled,auto:real.autoEnabled,outputs:await Promise.all(Object.values(real.store.notebooks).filter(n=>n.output).map(async n=>({path:n.output,text:await app.vault.adapter.exists(n.output)?await app.vault.adapter.read(n.output):null})))};
 root?.querySelector('.st-close')?.click();
 return {idle:true,paused:true,preservationCaptured:true,ai:real.aiEnabled,auto:real.autoEnabled};
})();
