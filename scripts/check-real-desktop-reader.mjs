import * as fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';import {build} from 'esbuild';
const root='C:/Users/pless/Documents/Obsidian/Supernote Cloud/Supernote/Note';const file=root+'/Reflections/2610 - Reflection.note';
const checksum=async()=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
const before=await checksum(),statBefore=await fs.stat(file);
const bundle=await build({entryPoints:['src/desktop-reader.ts'],bundle:true,platform:'node',format:'esm',write:false});const {DesktopReadOnlySource}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const reader=new DesktopReadOnlySource(fs);const book=await reader.open(file);const image=await book.render(1);await fs.writeFile('test-artifacts/desktop-real-page-1.png',Buffer.from(image.split(',')[1],'base64'));
const config=JSON.parse(await fs.readFile('private/desktop-config-source.json','utf8')).config;const satsang=config.rules.find(r=>r.id==='satsang');const eligible=await reader.list(root+'/Satsang',true,satsang.exclude);
const after=await checksum(),statAfter=await fs.stat(file);
const evidence={platform:'Windows desktop adapter',pages:book.descriptor.pages.length,page1:book.descriptor.pages[0],renderedPngBytes:Buffer.from(image.split(',')[1],'base64').length,sourceUnchanged:before===after&&statBefore.mtimeMs===statAfter.mtimeMs,sourceHash:after,satsangEligible:eligible.map(e=>e.path.split('/').pop()),aiRequests:0};book.close();await fs.writeFile('test-artifacts/desktop-reader-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
