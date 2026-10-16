(() => {
 const p=app.plugins.plugins['nomad-transcripts'];
 if(!p||p.task) throw new Error('Pause guard requires the idle production plugin');
 p.pause();
 return {version:p.manifest.version,paused:!!p.progress.paused,idle:!p.task,connected:!!p.subscriptionStatus.connected};
})()
