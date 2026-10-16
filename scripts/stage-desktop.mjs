import {readFile,writeFile,mkdir,copyFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const destination='C:/Users/pless/Documents/Obsidian/Vedas/.obsidian/plugins/nomad-transcripts';
try{await stat(destination);throw Error('Destination already exists: back up and inspect before overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
const {config}=JSON.parse(await readFile('private/desktop-config-source.json','utf8'));
const cloud='C:/Users/pless/Documents/Obsidian/Supernote Cloud/Supernote/Note';
for(const rule of config.rules){const prefix='/storage/emulated/0/Note/';if(!rule.source.startsWith(prefix))throw Error('Unexpected source mount');rule.source=cloud+'/'+rule.source.slice(prefix.length);if(!rule.sharedId)throw Error('Missing shared identity');}
await mkdir(destination,{recursive:true});
for(const filename of ['main.js','manifest.json','styles.css'])await copyFile(filename,path.join(destination,filename));
await writeFile(path.join(destination,'data.json'),JSON.stringify({config},null,2));
const sources=await Promise.all(config.rules.map(async r=>({id:r.id,sharedId:r.sharedId,output:r.output,excluded:r.exclude.length,sourcePresent:await stat(r.source).then(()=>true,()=>false)})));
console.log(JSON.stringify({staged:destination,version:'0.6.0',credentialsCopied:false,cacheRecordsAlreadySynced:(await readdir('C:/Users/pless/Documents/Obsidian/Vedas/Supernote Transcripts/Shared Data')).length,sources},null,2));
