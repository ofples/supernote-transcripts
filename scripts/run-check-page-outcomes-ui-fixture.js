globalThis.__fixtureRun_check_page_outcomes_ui_fixture={status:'running'}; Promise.resolve((async()=>{
 const c=window.__transcriptUIFixture,real=app.plugins.plugins['nomad-transcripts'];
 const doc=()=>{if(real.platform==='desktop'){if(!globalThis.activeDocument)throw Error('Desktop fixture must run in the active Settings window');return globalThis.activeDocument;}return document;},root=()=>doc().querySelector('.st-fullscreen-modal');
 if(!c||!root())throw Error('Open the isolated transcript UI fixture first');
 const realBefore={config:JSON.stringify(real.config),store:JSON.stringify(real.store),ai:real.aiEnabled,auto:real.autoEnabled,paused:real.progress.paused};
 const source=c.recoveryFixture.source,results=[];
 const wait=async test=>{for(let i=0;i<30;i++){if(test())return true;await new Promise(r=>setTimeout(r,40))}return false};
 const open=()=>app.commands.executeCommandById('nomad-transcripts-ui-fixture:open');
 const close=()=>{const b=root()?.querySelector('[aria-label="Close mirrors"]');if(b)b.click()};
 const detail=()=>{if(root().querySelector('h1')?.textContent?.trim()==='Notebook')return;const row=[...root().querySelectorAll('.st-rule-row')].find(x=>x.querySelector('.st-rule-source')?.textContent?.trim()==='Edited');if(!row)throw Error('Mock Edited row missing');row.click()};
 for(const platform of [real.platform]){
  c.platform=platform;await c.saveConfig();
  if(!root())open();
  if(!await wait(()=>root()))throw Error(`${platform} fixture panel did not open`);
  if(!await wait(()=>root()))throw Error(`${platform} fixture did not render`);
  detail();
  const panel=root(),issues=panel.querySelector('.st-page-issues');
  if(!issues||issues.hidden||!issues.textContent.includes('Other pages continue automatically')||!issues.textContent.includes('Retry or skip each failed page when ready'))throw Error(`${platform} page failure panel missing`);
  const retry=[...issues.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry');
  if(!retry)throw Error(`${platform} Retry control missing`);
  retry.click();
  if(c.pageIssueActions.at(-1)?.action!=='retry'||c.pageIssueActions.at(-1)?.source!==source)throw Error(`${platform} Retry did not call the mock action`);
  const state=c.store.notebooks[source];
  state.pageIssues['2']={fingerprint:'fixture-fingerprint-2',number:2,status:'failed',kind:'empty_response',reason:'Mock empty response; no paid request.',attempts:1,updatedAt:'2026-10-14T00:00:00.000Z'};
  await c.saveConfig();
  const skip=[...root().querySelectorAll('.st-page-issues button')].find(b=>b.textContent.trim()==='Skip');
  if(!skip)throw Error(`${platform} Skip control missing`);
  skip.click();
  if(c.pageIssueActions.at(-1)?.action!=='skip'||state.pageIssues['2'].status!=='skipped')throw Error(`${platform} Skip did not update only mock state`);
  results.push({platform,pageFailure:true,retry:true,skip:true});
  close();open();if(!await wait(()=>root()))throw Error(`${platform} fixture panel did not reopen`);
 }
 const realUnchanged=realBefore.config===JSON.stringify(real.config)&&realBefore.store===JSON.stringify(real.store)&&realBefore.ai===real.aiEnabled&&realBefore.auto===real.autoEnabled&&realBefore.paused===real.progress.paused;
 if(!realUnchanged)throw Error('A real production setting or cache changed during the mock fixture');
 return {mockOnly:true,realUnchanged,providerRequests:0,sourceWrites:0,results};
})()).then(value=>{globalThis.__fixtureRun_check_page_outcomes_ui_fixture={status:'done',value}},e=>{globalThis.__fixtureRun_check_page_outcomes_ui_fixture={status:'failed',name:String(e?.name||'Error'),message:String(e?.message||'')}});