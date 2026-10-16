(()=>{
 const root=document.querySelector('.st-fullscreen-modal'),p=app.plugins.plugins['nomad-transcripts'];
 if(!root)return {open:false};
 if(root.querySelector('.st-header h1')?.textContent!=='Mirror settings')return {open:true,editor:false};
 const short=path=>path.replace(/^\/storage\/emulated\/0\/Note\//,'');
 const source=root.querySelector('.st-source-choice p')?.textContent;
 const rule=p.config.rules.find(r=>short(r.source)===source);
 if(!rule)return {open:true,editor:true,unsaved:true,reason:'New or changed source'};
 const profile=p.config.profiles.find(x=>x.id===rule.profileId),changed=[];
 const expected={'Output folder':rule.output,'Recognition instructions':profile.prompt,'Exclusion prefixes':rule.exclude.join('\n'),'Model':profile.model,'Responses endpoint':profile.endpoint};
 for(const field of root.querySelectorAll('.st-field')){const label=field.querySelector('span')?.textContent,input=field.querySelector('input,textarea');if(label in expected&&input?.value!==expected[label])changed.push(label);}
 const checks=root.querySelectorAll('input[type=checkbox]');
 if(checks[0]?.checked!==rule.enabled)changed.push('Enabled');
 if(checks[1]?.checked!==rule.recursive)changed.push('Subfolders');
 const names=[...root.querySelectorAll('.st-glossary-row > span')].map(e=>e.textContent);
 if(JSON.stringify(names)!==JSON.stringify(profile.glossaries.map(path=>path.split('/').pop())))changed.push('Glossaries');
 return {open:true,editor:true,unsaved:changed.length>0,changedFields:changed};
})();
