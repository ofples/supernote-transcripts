globalThis.__fixtureRun_check_inline_mirror_browser_fixture={status:'running'}; Promise.resolve((async()=>{
 const c=window.__transcriptUIFixture,real=app.plugins.plugins['nomad-transcripts'];
 if(!c||!real)throw Error('Open the isolated transcript UI fixture first');
 const platform=real.platform;c.platform=platform;
 const doc=()=>{if(platform==='desktop'){if(!globalThis.activeDocument)throw Error('Desktop fixture must run in the active Settings window');return globalThis.activeDocument;}return document;};
 const root=()=>doc().querySelector('.st-fullscreen-modal');
 if(!root())throw Error('Fixture mirrors panel is not open');
 const realBefore={config:JSON.stringify(real.config),store:JSON.stringify(real.store),ai:real.aiEnabled,auto:real.autoEnabled,paused:real.progress.paused};
 const configBefore=JSON.stringify(c.config),folderName='Codex Mock Mirror Folder',fileName='Codex Mock Inline Fixture.note',childName='Codex Mock Nested Fixture.note';
 let captureRoot=false,appendRootListing=false,browserRoot='';
 const basePath=()=>browserRoot.replace(/\\/g,'/').replace(/\/+$/,'');
 const isFolder=path=>String(path).replace(/\\/g,'/')===`${basePath()}/${folderName}`;
 const isChild=path=>String(path).replace(/\\/g,'/')===`${basePath()}/${folderName}/${childName}`;
 const dirent=(name,directory=false)=>({name,isDirectory:()=>directory,isFile:()=>!directory&&name.toLowerCase().endsWith('.note')});
 let restoreFs=()=>{};
 const wait=async test=>{for(let i=0;i<50;i++){if(test())return true;await new Promise(r=>setTimeout(r,40))}return false};
 const clickText=text=>{const b=[...root().querySelectorAll('button')].find(x=>x.textContent.trim()===text);if(!b)throw Error(`Missing ${text}`);b.click();return b};
 const openBrowser=async()=>{if(root())root().querySelector('[aria-label="Close mirrors"]')?.click();app.commands.executeCommandById('nomad-transcripts-ui-fixture:open');if(!await wait(()=>root()))throw Error('Mock mirrors panel did not reopen');captureRoot=true;clickText('+ Add source');};
 const entryRow=name=>[...root().querySelectorAll('.st-browser-entry-row')].find(row=>row.textContent.includes(name));
 const waitEntry=async name=>{if(!await wait(()=>entryRow(name)))throw Error(`Mock filesystem entry missing: ${name}`);return entryRow(name)};
 const action=(row,label)=>{const b=[...row.querySelectorAll('button')].find(x=>x.textContent.trim()===label);if(!b)throw Error(`Missing inline ${label} action for ${row.textContent.trim()}`);return b};
 const addInline=async(name,existingRow)=>{const row=existingRow||await waitEntry(name);action(row,'Mirror').click();if(!await wait(()=>root()?.querySelector('.st-error')?.textContent.includes('Mirror added. Configure it later')))throw Error(`Inline Mirror did not save ${name}`)};
 try{
  c.config.rules=[];await c.saveConfig();
  if(platform==='desktop'){
   const fs=require('fs'),promises=fs.promises,original=promises.readdir;
   promises.readdir=async(path,options)=>{
    if(isFolder(path))return options?.withFileTypes?[dirent(childName)]:[childName];
    if(captureRoot){captureRoot=false;browserRoot=String(path);appendRootListing=true;}
    if(appendRootListing&&String(path)===browserRoot){const entries=await original.call(promises,path,options);return options?.withFileTypes?[...entries,dirent(folderName,true),dirent(fileName)]:[...entries,folderName,fileName]}
    return original.call(promises,path,options);
   };
   restoreFs=()=>{promises.readdir=original};
  }else{
   const fs=app.vault.adapter.fs,originalRead=fs?.readdir,originalStat=fs?.stat;
   if(!fs||!originalRead||!originalStat)throw Error('Nomad adapter filesystem is unavailable');
   fs.readdir=async path=>{
    if(isFolder(path))return [childName];
    if(captureRoot){captureRoot=false;browserRoot=String(path);appendRootListing=true;}
    if(appendRootListing&&String(path)===browserRoot){const entries=await originalRead.call(fs,path);return [...entries,folderName,fileName]}
    return originalRead.call(fs,path);
   };
   fs.stat=async path=>isFolder(path)?{type:'directory'}:isChild(path)||String(path).replace(/\\/g,'/')===`${basePath()}/${fileName}`?{type:'file'}:originalStat.call(fs,path);
   restoreFs=()=>{fs.readdir=originalRead;fs.stat=originalStat};
  }
  await openBrowser();
  if(!await wait(()=>root()?.querySelector('.st-browser')))throw Error(`${platform} source browser did not open`);
  const inlineFileRow=await waitEntry(fileName.slice(0,-5));const inlineTitle=inlineFileRow.querySelector('.st-browser-entry')?.title;globalThis.__inlineMirrorDiag={rows:root().querySelectorAll('.st-browser-entry-row').length,rowFound:!!inlineFileRow,titleFound:!!inlineTitle,titleHasSyntheticName:inlineTitle?.endsWith(fileName)||false};const filePath=inlineTitle;
  if(!filePath)throw Error(`${platform} inline notebook entry has no mock path`);
  await addInline(fileName.replace(/\.note$/i,''),inlineFileRow);
  if(c.config.rules.length!==1||c.config.rules[0].source!==filePath)throw Error(`${platform} inline Mirror did not immediately save exactly one source`);
  const configured=await waitEntry(fileName.replace(/\.note$/i,''));action(configured,'Configure').click();
  if(!await wait(()=>root()?.querySelector('.st-form')))throw Error(`${platform} Configure did not open the source editor`);
  if(!root().querySelector('.st-source-choice')?.textContent.includes(fileName.replace(/\.note$/i,'')))throw Error(`${platform} Configure opened a different source`);
  clickText('Cancel');if(c.config.rules.length!==1)throw Error(`${platform} Configure changed the saved source count`);
  await openBrowser();
  (await waitEntry(folderName)).querySelector('.st-browser-entry').click();
  if(!await wait(()=>entryRow(childName.slice(0,-5))))throw Error(`${platform} mock folder did not list its child notebook`);
  const childPath=entryRow(childName.slice(0,-5))?.querySelector('.st-browser-entry')?.title;if(!childPath)throw Error(`${platform} nested mock notebook path missing`);
  const crumb=root().querySelector('button.st-browser-crumb');if(crumb)crumb.click();else clickText('Parent folder');
  if(!await wait(()=>entryRow(folderName)))throw Error(`${platform} could not return to mock root`);
  await addInline(folderName);
  const folderPath=c.config.rules.find(rule=>rule.source.endsWith(folderName))?.source;
  if(!folderPath||c.config.rules.length!==2)throw Error(`${platform} inline Mirror did not save the folder`);
  await openBrowser();
  const mirroredFolder=await waitEntry(folderName);action(mirroredFolder,'Configure').click();
  if(!await wait(()=>root()?.querySelector('.st-form')))throw Error(`${platform} folder Configure did not open its editor`);
  clickText('Cancel');await openBrowser();
  (await waitEntry(folderName)).querySelector('.st-browser-entry').click();
  if(!await wait(()=>entryRow(childName.slice(0,-5))))throw Error(`${platform} nested entry disappeared`);
  const child=entryRow(childName.slice(0,-5)),coveredAction=child.querySelectorAll('button')[1]?.textContent.trim();
  const childRuleCount=c.config.rules.filter(rule=>rule.source===childPath).length;
  if(coveredAction!=='Configure')throw Error(`${platform} parent-covered child should offer Configure, got ${coveredAction||'no action'}`);
  action(child,'Configure').click();
  if(!await wait(()=>root()?.querySelector('.st-form')))throw Error(`${platform} parent-covered child did not configure its parent`);
  if(c.config.rules.length!==2||childRuleCount!==0)throw Error(`${platform} parent-covered child created a duplicate mirror`);
  if(!c.sourceSelected(childPath)||!c.config.rules.find(rule=>rule.source===folderPath)?.recursive)throw Error(`${platform} child is not included through the recursive parent`);
  return {mockOnly:true,platform,inlineNotebookSaved:true,configureLater:true,inlineFolderSaved:true,parentChildConfiguresParent:true,childIncludedByParent:true,noDuplicateChildRule:true,providerRequests:0,sourceWrites:0};
 }finally{
  restoreFs();c.config=JSON.parse(configBefore);await c.saveConfig();
  root()?.querySelector('[aria-label="Close mirrors"]')?.click();
 }
})().then(result=>{globalThis.__inlineMirrorBrowserFixtureResult=result;return result})).then(value=>{globalThis.__fixtureRun_check_inline_mirror_browser_fixture={status:'done',value}},e=>{globalThis.__fixtureRun_check_inline_mirror_browser_fixture={status:'failed',name:String(e?.name||'Error'),message:String(e?.message||'')}});