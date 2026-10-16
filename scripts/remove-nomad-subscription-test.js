(async () => {
 const id='nomad-subscription-test', production=app.plugins.plugins['nomad-transcripts'];
 if(!production||production.task||!production.progress.paused)throw Error('Pause production and wait for its current page first.');
 const test=app.plugins.plugins[id];
 if(test?.working||test?.finishing||test?.renewing)throw Error('Wait for the test plugin account operation to finish.');
 const secrets=app.secretStorage;
 if(!secrets||await secrets.isEncryptionAvailable()!==true)throw Error('Secure storage is unavailable.');
 const productionKey='nomad-transcripts-chatgpt-session', testKey='nomad-transcripts-subscription-test';
 const prefix=`nomad-transcripts:${app.vault.getName()}`;
 const snapshot=()=>JSON.stringify({config:production.config,store:production.store,session:secrets.getSecret(productionKey),key:production.apiKey,provider:production.provider,ai:production.aiEnabled,auto:production.autoEnabled,costs:localStorage.getItem(prefix+':spending-v1'),usage:localStorage.getItem(prefix+':subscription-usage-v1')});
 const before=snapshot();
 await app.plugins.disablePluginAndSave(id);
 await secrets.setSecret(testKey,'');
 const enabled=JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/community-plugins.json`));
 if(app.plugins.plugins[id]||enabled.includes(id)||secrets.getSecret(testKey))throw Error('Test plugin removal did not finish.');
 if(before!==snapshot())throw Error('Production preservation check failed.');
 return {testDisabled:true,testSessionCleared:true,productionPreserved:true,productionConnected:production.subscriptionStatus.connected,recognitionRequests:0};
})();
