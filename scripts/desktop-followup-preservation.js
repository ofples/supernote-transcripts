(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'],b=window.__desktopFollowupBefore;
 const preservation={baseline:!!b,key:b&&p.apiKey===b.key,ai:b&&p.aiEnabled===b.ai,auto:b&&p.autoEnabled===b.auto,cache:b&&JSON.stringify(p.store)===b.store,costs:b&&localStorage.getItem(`nomad-transcripts:${app.vault.getName()}:spending-v1`)===b.costs};
 const native=await Promise.race([app.vault.adapter.exists('Supernote Transcripts/Transcripts').then(value=>({exists:value})).catch(e=>({error:String(e)})),new Promise(r=>setTimeout(()=>r({timeout:true}),5000))]);
 return {preservation,native,hidden:document.hidden};
})();
