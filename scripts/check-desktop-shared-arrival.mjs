import * as fs from 'node:fs/promises';import path from 'node:path';
const root='C:/Users/pless/Documents/Obsidian/Vedas/Supernote Transcripts/Shared Data';
async function walk(p){const out=[];for(const d of await fs.readdir(p,{withFileTypes:true})){const file=path.join(p,d.name);if(d.isDirectory())out.push(...await walk(file));else if(d.name.endsWith('.md'))out.push(file);}return out;}
const kinds={};const files=await walk(root);for(const file of files){const t=await fs.readFile(file,'utf8');const match=/```json\n([\s\S]*?)\n```/.exec(t);if(match){const r=JSON.parse(match[1]);kinds[r.kind??('publication-v'+r.version)]=(kinds[r.kind??('publication-v'+r.version)]??0)+1;}}
console.log(JSON.stringify({receivedSharedMarkdownRecords:files.length,kinds},null,2));
