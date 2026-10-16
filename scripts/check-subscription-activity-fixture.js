(async()=>{
 const c=window.__transcriptUIFixture,root=()=>document.querySelector('.st-fullscreen-modal');if(!c||!root())throw Error('Require isolated fixture');
 const real=app.plugins.plugins['nomad-transcripts'],before=JSON.stringify(real.costs);
 c.provider='subscription';c.subscriptionUsage={pages:4,requests:5,inputTokens:12000,outputTokens:3200,unconfirmed:1};c.resolveUnconfirmedCosts=async()=>{c.subscriptionUsage.unconfirmed=0;};
 root().querySelector('[aria-label="Costs"]').click();let text=root().innerText;if(!text.includes('4 pages')||text.includes('$'))throw Error('Wrong subscription activity');
 const click=text=>{const b=[...root().querySelectorAll('button')].find(b=>b.textContent===text);if(!b)throw Error('Missing '+text);b.click();};
 click('Count interrupted requests');await new Promise(r=>setTimeout(r,0));if(c.subscriptionUsage.unconfirmed!==0||c.subscriptionUsage.requests!==5)throw Error('Request count recovery incorrect');
 let input=root().querySelector('input[type="number"]');input.value='220';input.dispatchEvent(new Event('input'));click('Cancel');if(c.costs.settings.dailyRequests!==50)throw Error('Cancel changed limits');
 root().querySelector('[aria-label="Costs"]').click();input=root().querySelector('input[type="number"]');input.value='220';input.dispatchEvent(new Event('input'));click('Save');await new Promise(r=>setTimeout(r,0));if(c.costs.settings.dailyRequests!==220)throw Error('Save failed');
 if(JSON.stringify(real.costs)!==before||!real.progress.paused||real.task)throw Error('Real accounting/work changed');
 return {subscriptionActivity:true,noDollarEstimate:true,requestLimitCancel:true,requestLimitSave:true,interruptionAcknowledged:true,requestsRetained:true,realLedgerPreserved:true,aiCalls:0};
})();
