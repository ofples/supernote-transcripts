(async()=>{
 const p=app.plugins.plugins['nomad-transcripts'];if(!p||p.manifest.version!=='0.6.4'||p.task||p.initializing||!p.progress.paused||!p.subscriptionStatus.connected)throw Error('Expected production 0.6.4 connected, idle and paused');
 const docs=[document];if(globalThis.activeDocument&&globalThis.activeDocument!==document)docs.push(globalThis.activeDocument);
 if(docs.some(d=>d.querySelector('.modal-container')))throw Error('Preserve any existing user form');
 await app.plugins.loadManifests();await app.plugins.loadPlugin('nomad-transcripts-ui-fixture');
 app.commands.executeCommandById('nomad-transcripts-ui-fixture:open');
 for(let i=0;i<50;i++){const active=globalThis.activeDocument;const roots=p.platform==='desktop'&&active?[...active.querySelectorAll('.st-fullscreen-modal')]:docs.flatMap(d=>[...d.querySelectorAll('.st-fullscreen-modal')]);if(roots.length===1){const result={loaded:true,panelOpen:true,version:p.manifest.version,platform:p.platform,connected:!!p.subscriptionStatus.connected,idle:!p.task,paused:!!p.progress.paused,oneFixtureModal:true};globalThis.__inlineBrowserFixtureOpen=result;return result;}await new Promise(r=>setTimeout(r,40));}
 throw Error('Mock fixture panel did not open in the active document');
})();
