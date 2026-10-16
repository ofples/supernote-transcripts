(()=>{
 const p=app.plugins.plugins['nomad-transcripts'],root=document.querySelector('.st-fullscreen-modal');if(!p||p.task||!p.progress.paused||root?.querySelector('h1')?.textContent!=='Settings')throw Error('Preserve other work or forms');
 let count=0;for(const [label,method] of [['Connect ChatGPT account','connectSubscription'],['Finish sign-in','finishSubscriptionLogin'],['Disconnect','disconnectSubscription']]){
  const old=[...root.querySelectorAll('button')].find(b=>b.textContent===label);if(!old)continue;const button=old.cloneNode(true);old.replaceWith(button);
  button.addEventListener('click',()=>{button.disabled=true;Promise.resolve().then(()=>p[method]()).then(()=>{const s=p.subscriptionStatus,display=root.querySelector('.st-subscription-status');if(display)display.textContent=s.connected?'ChatGPT plan connected':s.status;}).catch(error=>{const display=root.querySelector('.st-subscription-status');if(display)display.textContent=error?.message||'Sign-in could not complete.';}).finally(()=>{button.disabled=false;});});count++;
 }
 return {patchedOwnButtons:count,formPreserved:true,recognitionPaused:p.progress.paused,accountOperationStarted:false};
})();
