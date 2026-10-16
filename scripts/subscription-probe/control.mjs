import {readFile} from 'node:fs/promises';
const {port,secret}=JSON.parse(await readFile(new URL('../../private/subscription-probe/control.json',import.meta.url),'utf8'));
if(['status','shutdown','models'].includes(process.argv[2])) {
  const r=await fetch(`http://127.0.0.1:${port}/${process.argv[2]}`,{method:process.argv[2]==='shutdown'?'POST':'GET',headers:{'X-Probe-Secret':secret}});
  console.log(JSON.stringify(await r.json()));
} else {
  const targets=await (await fetch('http://127.0.0.1:19222/json/list')).json();
  const target=targets.find(t=>t.type==='page'&&t.url.startsWith('https://localhost/')) || targets[0];
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const mode=process.argv[2];
  const expression=mode==='connect'?`(async()=>{const real=app.plugins.plugins['nomad-transcripts'];if(real?.task)throw Error('Worker busy');await app.plugins.loadManifests();await app.plugins.loadPlugin('nomad-subscription-probe');const p=app.plugins.plugins['nomad-subscription-probe'];p.connectBridge(${JSON.stringify(secret)});return {loaded:!!p,productionUnchanged:true};})()`:
    mode==='open'?`(()=>{if(document.querySelector('.modal-container'))throw Error('Preserve the open form');app.plugins.plugins['nomad-subscription-probe'].open();return {open:true};})()`:
    mode==='result'?`(()=>{const p=app.plugins.plugins['nomad-subscription-probe'];return {result:p?.lastResult??null,catalog:p?.lastCatalog??null,status:document.querySelector('.st-subscription-probe')?.innerText};})()`:
    mode==='close'?`(async()=>{await app.plugins.unloadPlugin('nomad-subscription-probe');return {closed:true};})()`:
    (()=>{throw Error('Unknown control action');})();
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.close();reject(Error('Device check timed out'));},20000);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(t);if(m.result?.exceptionDetails){console.log('Device action declined; preserve the current screen.');process.exitCode=1;}else console.log(JSON.stringify(m.result.result.value));ws.close();resolve();}};});
}
