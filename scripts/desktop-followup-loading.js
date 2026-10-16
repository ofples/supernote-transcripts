(async()=>{
 const withTimeout=async task=>Promise.race([task,new Promise(r=>setTimeout(()=>r('timeout'),5000))]);
 const read=await withTimeout(app.vault.adapter.read('Supernote Transcripts/Glossaries/Sanskrit.txt').then(t=>({length:t.length})).catch(e=>({error:String(e)})));
 return {plugins:Object.keys(app.plugins.plugins),manifest:app.plugins.manifests['nomad-transcripts']?.version,loaded:!!app.plugins.plugins['nomad-transcripts'],glossary:read,modal:!!document.querySelector('.modal-container')};
})();
