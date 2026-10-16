(async()=>{
 const c=window.__transcriptUIFixture,root=()=>document.querySelector('.st-fullscreen-modal');
 const click=text=>{const b=[...root().querySelectorAll('button')].find(x=>x.textContent===text);if(!b)throw Error('Missing '+text);b.click()};
 const wait=()=>new Promise(r=>setTimeout(r,100));
 root().querySelector('[aria-label="Back"]').click();root().querySelector('[aria-label="Configure Fixture"]').click();
 const pending=[];c.listNotebookChoices=()=>new Promise(resolve=>pending.push(resolve));
 click('Select notebooks');await wait();root().querySelector('[aria-label="Back"]').click();click('Select notebooks');await wait();
 pending[0]([{source:'/storage/emulated/0/Note/Fixture/stale.note',relative:'stale.note',existingTranscripts:[]}]);await wait();
 pending[1]([{source:'/storage/emulated/0/Note/Fixture/current.note',relative:'current.note',existingTranscripts:[]}]);await wait();
 if(root().querySelectorAll('.st-notebook-choice').length!==1||root().innerText.includes('stale.note'))throw Error('Stale catalog replaced current selection');
 click('Cancel');click('Cancel');
 return {lateCatalogIgnored:true,backPreservesDraft:true,realAI:app.plugins.plugins['nomad-transcripts'].aiEnabled};
})();
