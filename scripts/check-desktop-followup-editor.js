(async()=>{
 const c=window.__transcriptUIFixture,root=()=>document.querySelector('.st-fullscreen-modal');if(!c||!root())throw Error('Require isolated fixture');
 root().querySelector('[aria-label="Close mirrors"]').click();c.platform='nomad';c.aiEnabled=false;c.progress.running=false;
 app.commands.executeCommandById('nomad-transcripts-ui-fixture:open');root().querySelector('[aria-label="Configure 2610 - Reflection"]').click();
 const picker=root().querySelector('.st-model-picker');if(!picker)throw Error('Model selector missing');picker.closest('details').open=true;
 const select=picker.querySelector('select');select.value='__custom__';select.dispatchEvent(new Event('change',{bubbles:true}));
 const input=picker.querySelector('input');input.value='custom-test-model';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();await c.saveConfig();
 if(document.activeElement!==input||input.value!=='custom-test-model'||input.hidden)throw Error('Custom model draft/focus not preserved');
 input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();
 return {customDropdown:true,draftPreserved:true,focusPreserved:true,duplicateCloseButtons:root().querySelectorAll('.modal-close-button').length,target:{x:(r.left+r.right)/2,y:(r.top+r.bottom)/2},scale:devicePixelRatio,realPaused:app.plugins.plugins['nomad-transcripts'].progress.paused};
})();
