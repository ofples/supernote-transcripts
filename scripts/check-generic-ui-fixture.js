(async()=>{
 const c=window.__transcriptUIFixture,real=app.plugins.plugins['nomad-transcripts'];
 const original=JSON.stringify(real.config),root=()=>document.querySelector('.st-fullscreen-modal');
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 const click=text=>{const b=[...root().querySelectorAll('button')].find(e=>e.textContent.trim()===text);if(!b)throw Error(`Missing ${text}`);b.click()};
 const checkButtons=()=>{
  const buttons=[...root().querySelectorAll('button.st-button')];
  for(const b of buttons){const s=getComputedStyle(b),primary=b.classList.contains('st-primary');
   assert(primary?s.borderTopStyle==='solid'&&s.borderTopColor===s.color:s.borderTopWidth==='0px'||s.borderTopColor==='rgba(0, 0, 0, 0)',`Wrong border: ${b.textContent}`);
  }
  return buttons.length;
 };
 app.commands.executeCommandById('nomad-transcripts-ui-fixture:open');
 root().querySelector('[aria-label="Settings"]').click();
 const checkbox=root().querySelector('input[type=checkbox]');
 assert(!checkbox.checked,'Mock AI should be off');
 const off=getComputedStyle(checkbox);assert(off.appearance==='none'&&off.borderRadius==='0px'&&off.backgroundImage==='none','Off checkbox is not a square outline');
 checkbox.closest('label').click();
 const on=getComputedStyle(checkbox);assert(checkbox.checked&&on.backgroundSize==='16px 16px'&&on.backgroundImage.startsWith('linear-gradient('),'Label failed to toggle inner square');
 assert(getComputedStyle(checkbox,'::after').content==='none','Tick pseudo-element survived');
 const settingsButtons=checkButtons();click('Cancel');assert(!c.aiEnabled,'Cancel changed mock AI');
 root().querySelector('[data-config-id]').click();
 assert(!root().textContent.includes('Import bundled'),'Bundled glossary action remains');
 assert(![...root().querySelectorAll('button')].some(b=>/sanskrit/i.test(b.textContent)),'Subject-specific control remains');
 const editorButtons=checkButtons();
 const enabled=root().querySelector('input[type=checkbox]');assert(getComputedStyle(enabled).backgroundSize==='16px 16px','Enabled source lacks inner square');
 click('Cancel');root().querySelector('.st-rule-row[role=button]').click();
 const detailButtons=checkButtons();
 const result={genericControls:true,squareCheckbox:true,labelToggles:true,noTick:true,consistentButtons:true,settingsButtons,editorButtons,detailButtons,realConfigPreserved:JSON.stringify(real.config)===original,realAI:real.aiEnabled,realAutomatic:real.autoEnabled};
 assert(result.realConfigPreserved&&!result.realAI&&!result.realAutomatic&&!real.task,'Real state changed');
 root().querySelector('.st-close').click();
 return result;
})();
