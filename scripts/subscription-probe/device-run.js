(()=>{
 const root=document.querySelector('.st-subscription-probe');
 const b=[...root.querySelectorAll('button')].find(x=>x.textContent==='Test one page');
 if(!b||b.disabled)throw Error('Subscription test is not ready');
 const p=app.plugins.plugins['nomad-transcripts'];
 if(p.task||!p.progress.paused)throw Error('Keep the normal worker idle and paused');
 const path=root.querySelector('[aria-label="Notebook path"]').value;
 const page=Number(root.querySelector('[aria-label="Page"]').value);
 b.click();return {started:true,path,page,normalWorkerPaused:true,apiFallback:false};
})();
