import {writeFile} from 'node:fs/promises';
const targets=await (await fetch('http://127.0.0.1:19222/json/list')).json();
const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
try{
 if(process.argv[3]==='desktop')await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 if(process.argv[3]==='restore')await send('Emulation.clearDeviceMetricsOverride');
 const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(process.argv[2],Buffer.from(r.data,'base64'));console.log(JSON.stringify({screenshot:process.argv[2],mode:process.argv[3]??'native'}));
}finally{ws.close();}
