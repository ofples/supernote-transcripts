import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const dir='test-artifacts/subscription-nomad';await mkdir(dir,{recursive:true});
await build({entryPoints:['scripts/subscription-nomad/plugin.ts'],bundle:true,outfile:`${dir}/main.js`,platform:'browser',format:'cjs',target:'chrome100',external:['obsidian'],minify:true});
await writeFile(`${dir}/manifest.json`,JSON.stringify({id:'nomad-subscription-test',name:'Nomad subscription test',version:'0.1.0',minAppVersion:'1.11.0',description:'Isolated device-only ChatGPT subscription test. One page, encrypted session, no notebook writes.',author:'Personal tools',isDesktopOnly:false},null,2));
await writeFile(`${dir}/styles.css`,await readFile('scripts/subscription-nomad/styles.css','utf8'));
