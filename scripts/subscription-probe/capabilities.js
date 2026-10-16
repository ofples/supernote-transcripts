(()=>({
 vault:app.vault.configDir,
 workerBusy:!!app.plugins.plugins['nomad-transcripts']?.task,
 workerPaused:app.plugins.plugins['nomad-transcripts']?.progress.paused,
 modalTitle:document.querySelector('.modal-container h1')?.textContent,
 capacitorPlugins:Object.keys(window.Capacitor?.Plugins??{}),
 cordovaPlugins:typeof cordova!=='undefined'?Object.keys(cordova.plugins??{}):[],
 webCrypto:!!window.crypto?.subtle,
 secretStorage:typeof app.secretStorage,
 cordovaKeys:typeof cordova!=='undefined'?Object.keys(cordova):[],
 nativePlugins:window.Capacitor?.PluginHeaders?.map(p=>({name:p.name,methods:p.methods?.map(m=>m.name)}))??[]
}))();
