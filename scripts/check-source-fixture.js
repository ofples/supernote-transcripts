(async()=>{
 const c=window.__transcriptUIFixture,root=()=>document.querySelector('.st-fullscreen-modal');
 const click=text=>{const b=[...root().querySelectorAll('button')].find(x=>x.textContent.trim()===text);if(!b)throw Error(`Missing button: ${text}`);b.click()};
 const before=JSON.stringify(c.config.profiles.find(p=>p.id==='general'));
 const folder=[...root().querySelectorAll('.st-browser-entry')].find(x=>x.textContent.includes('Projects'));if(!folder)throw Error('Projects folder unavailable');folder.click();await new Promise(r=>setTimeout(r,800));
 click('Choose this folder');
 const prompt=root().querySelector('textarea');prompt.value='Isolated UI test instructions';prompt.dispatchEvent(new Event('input',{bubbles:true}));
 click('Choose glossary files');await new Promise(r=>setTimeout(r,1800));
 const glossary=[...root().querySelectorAll('label')].find(x=>x.textContent.includes('Sanskrit.txt'));if(!glossary)throw Error('Sanskrit glossary not found');const checkbox=glossary.querySelector('input');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));click('Done');
 click('Save');await new Promise(r=>setTimeout(r,50));
 const rule=c.config.rules.find(r=>r.source.endsWith('/Projects'));
 const profile=c.config.profiles.find(p=>p.id===rule?.profileId);
 if(!profile||profile.prompt!=='Isolated UI test instructions'||!profile.glossaries.some(p=>p.endsWith('Sanskrit.txt')))throw Error('Per-source instructions did not save');
 if(JSON.stringify(c.config.profiles.find(p=>p.id==='general'))!==before)throw Error('Shared default changed');
 return {sourcePicker:true,glossaryPicker:true,independentSourceProfile:true,defaultProfileUnchanged:true,savedOnlyToMemory:true,heading:root().querySelector('h1')?.textContent};
})();
