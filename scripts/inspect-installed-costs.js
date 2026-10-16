(()=>{
 const p=app.plugins.plugins['nomad-transcripts'],root=document.querySelector('.st-fullscreen-modal');
 if(p.task||p.aiEnabled||p.autoEnabled)throw Error('Idle AI-off worker required');
 [...root.querySelectorAll('button')].find(x=>x.innerText==='Costs').click();
 const panel=document.querySelector('.st-fullscreen-modal');
 const rect=panel.querySelector('.st-close').getBoundingClientRect();
 return {version:p.manifest.version,limitsCollapsed:!panel.querySelector('.st-cost-settings').open,body:panel.innerText,closeRightGap:innerWidth-rect.right,costRequests:p.costs.total.requests};
})();
