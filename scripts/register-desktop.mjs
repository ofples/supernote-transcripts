import * as fs from 'node:fs/promises';
const file='C:/Users/pless/Documents/Obsidian/Vedas/.obsidian/community-plugins.json';const original=await fs.readFile(file,'utf8');const ids=JSON.parse(original);if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Unexpected plugin list');
await fs.writeFile('private/backups/desktop-followup-20261007/vedas-community-plugins.json',original);
if(!ids.includes('nomad-transcripts')){if(await fs.readFile(file,'utf8')!==original)throw Error('Plugin list changed during preparation');ids.push('nomad-transcripts');await fs.writeFile(file,JSON.stringify(ids,null,2));}
console.log(JSON.stringify({registeredForNextReload:true,preservedExistingPluginIds:ids.filter(id=>id!=='nomad-transcripts'),liveActivationVerified:false,aiCalls:0}));
