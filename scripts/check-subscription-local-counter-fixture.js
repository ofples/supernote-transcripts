(async()=>{
 const c=window.__transcriptUIFixture,real=app.plugins.plugins['nomad-transcripts'];
 const doc=()=>real.platform==='desktop'?(globalThis.activeDocument||document):document,root=()=>doc().querySelector('.st-fullscreen-modal');
 if(!c||!root()||!real.progress.paused||real.task)throw Error('Require the isolated fixture and paused, idle production');
 const realBefore={config:JSON.stringify(real.config),store:JSON.stringify(real.store),session:JSON.stringify(real.chatGPT?.record),costs:JSON.stringify(real.costs),usage:JSON.stringify(real.subscriptionUsage),provider:real.provider};
 const results=[];
 for(const platform of [real.platform]){
  c.platform=platform;c.provider='subscription';
  c.subscriptionUsage={pages:4,requests:5,inputTokens:12000,outputTokens:3200,unconfirmed:1,todayRequests:2,dailyLimit:30,day:'2026-10-14'};
  await c.saveConfig();
  if(!root())throw Error(`${platform} fixture panel missing`);
  const costs=root().querySelector('[aria-label="Costs"]');if(!costs)throw Error(`${platform} Costs control missing`);costs.click();
  const text=root().querySelector('.st-cost-screen')?.innerText||'';
  const checks={
   trackedActivity:text.includes('All tracked activity since tracking began'),
   pageAndAttemptLabels:text.includes('4 pages · 5 request attempts'),
   reportedTokenLabels:text.includes('12,000 input tokens · 3,200 output tokens reported'),
   localInterruptedLabel:text.includes('1 interrupted attempt is already counted toward the local request limit.'),
   dailyLocalLimit:text.includes('Today (UTC): 2 of 30 attempts (local limit)'),
   noDollarQuota:text.includes('ChatGPT manages plan allowance')&&!text.includes('$'),
   noCountGate:![...root().querySelectorAll('.st-cost-screen button')].some(b=>/count/i.test(b.textContent)),
  };
  if(Object.values(checks).some(value=>!value))throw Error(`${platform} subscription labels or no-count behavior failed`);
  results.push({platform,...checks});
  const cancel=[...root().querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel');if(!cancel)throw Error(`${platform} subscription activity Cancel button missing`);cancel.click();
 }
 const realUnchanged=realBefore.config===JSON.stringify(real.config)&&realBefore.store===JSON.stringify(real.store)&&realBefore.session===JSON.stringify(real.chatGPT?.record)&&realBefore.costs===JSON.stringify(real.costs)&&realBefore.usage===JSON.stringify(real.subscriptionUsage)&&realBefore.provider===real.provider;
 if(!realUnchanged||!real.progress.paused||real.task)throw Error('Real production account, work, or usage state changed');
 return {mockOnly:true,realUnchanged,providerRequests:0,sourceWrites:0,results};
})();
