(async()=>{
 const p=app.plugins.plugins['nomad-subscription-test'];if(!p?.record.tokens)throw Error('Complete sign-in first');
 const s=app.secretStorage,key='nomad-transcripts-subscription-test';
 const before=s.getSecret(key);await s.load();
 if(s.getSecret(key)!==before)throw Error('Native persistence readback did not match');
 await app.plugins.unloadPlugin('nomad-subscription-test');
 await app.plugins.loadPlugin('nomad-subscription-test');
 const reloaded=app.plugins.plugins['nomad-subscription-test'];
 if(!reloaded?.record.tokens || !reloaded.record.tokens.refreshToken)throw Error('Session did not survive reload');
 reloaded.open();
 return {nativeReadbackConfirmed:true,connectedAfterReload:true,renewableSessionOnDevice:true,readyForOnePage:!reloaded.record.testAttempted,status:reloaded.status};
})();
