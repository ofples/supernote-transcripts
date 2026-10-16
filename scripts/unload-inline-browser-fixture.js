(async()=>{
 const docs=[document];if(globalThis.activeDocument&&globalThis.activeDocument!==document)docs.push(globalThis.activeDocument);
 for(const doc of docs)doc.querySelector('.st-fullscreen-modal')?.querySelector('[aria-label="Close mirrors"]')?.click();
 if(app.plugins.plugins['nomad-transcripts-ui-fixture'])await app.plugins.unloadPlugin('nomad-transcripts-ui-fixture');
 return {unloaded:!app.plugins.plugins['nomad-transcripts-ui-fixture'],ownPanelClosed:docs.every(d=>!d.querySelector('.st-fullscreen-modal'))};
})();
