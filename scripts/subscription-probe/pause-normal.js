(()=>{
 const real=app.plugins.plugins['nomad-transcripts'];
 if(!real.progress.paused)real.pause();
 return {paused:real.progress.paused,running:!!real.task,stage:real.progress.stage,activePage:real.progress.activePage,detail:real.progress.detail};
})();
