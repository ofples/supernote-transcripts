(async()=>{
 if(document.querySelector('.modal-container'))throw Error('Preserve the open form');
 await app.plugins.loadManifests();await app.plugins.enablePluginAndSave('nomad-subscription-test');
 const p=app.plugins.plugins['nomad-subscription-test'];if(!p?.record)throw Error('Test plugin unavailable');p.open();
 return {loaded:true,...p.safeStatus()};
})();
