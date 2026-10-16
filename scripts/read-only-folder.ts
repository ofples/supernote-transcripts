import { AndroidReadOnlySource } from '../src/reader';
// No plugin, state writes, transcription controller or provider calls.
export async function scan(folder: string, sampleCount=2) {
  const app=(window as any).app;
  const reader=new AndroidReadOnlySource(app.vault.adapter.fs);
  const listed=await reader.list(folder,true,[]);
  const samples=[];
  for(const file of [...listed].sort((a,b)=>a.size-b.size).slice(0,sampleCount)){
    const opened=await reader.open(file.path);
    samples.push({name:file.path.split('/').pop(),pages:opened.descriptor.pages.length});
    await opened.close();
  }
  return {folder,notebooks:listed.length,bytes:listed.reduce((n,f)=>n+f.size,0),sampled:samples,aiCalls:0};
}
