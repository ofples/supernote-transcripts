import {readFile,writeFile} from 'node:fs/promises';
const code=await readFile('test-artifacts/read-only-folder.js','utf8');
await writeFile('test-artifacts/start-folder-check.js',code+`;window.__transcriptFolderReadOnly={status:'running'};TranscriptFolderCheck.scan('/storage/emulated/0/Note/Reflections',2).then(result=>window.__transcriptFolderReadOnly={status:'complete',result}).catch(e=>window.__transcriptFolderReadOnly={status:'failed',error:String(e)});({started:true,aiRequests:0});`);
