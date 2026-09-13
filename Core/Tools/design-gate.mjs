import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {checkDocs} from './check-docs.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const digest=data=>createHash('sha256').update(data).digest('hex');
const product=p=>/^(Core\/(Source|Tools|Tests)\/|Plugins\/|Core\/(package(-lock)?\.json|CMakeLists\.txt|tsconfig\.json)$)/.test(p);
export function checkDesignDiff(paths){if(paths.some(product)&&!paths.some(p=>/^Docs\/(Architecture|Contracts)\/[^\n]+\.md$/.test(p)))throw Error('Product changes require an Architecture/Contracts design update first');}
async function snapshot(base){const hashes={};async function walk(p){for(const e of await readdir(join(base,p),{withFileTypes:true})){const f=`${p}/${e.name}`;if(e.isDirectory())await walk(f);else if(e.isFile())hashes[f]=digest(await readFile(join(base,f)));}}for(const p of ['Core/Source','Core/Tools','Core/Tests'])await walk(p);return hashes;}
export async function designGate(base,command,id,docs=[]){
 if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id??''))throw Error('Invalid design task ID');
 const folder=join(base,'Core/State/Design',id),head=join(folder,'current.json');
 if(command==='begin'){
  await checkDocs(base);if(!docs.length)throw Error('Choose owner design documents');
  const inventory=JSON.parse(await readFile(join(base,'Docs/Development/documents.json'),'utf8')).documents;
  const documents={};for(const path of docs){if(!inventory.some(d=>d.path===path&&['architecture','contract'].includes(d.role)))throw Error(`Not a registered owner design: ${path}`);const bytes=await readFile(join(base,path));if(!/^Design status: ready\s*$/m.test(bytes.toString()))throw Error(`Design not ready: ${path}`);documents[path]=digest(bytes);}
  const receipt={version:1,id,created_at:new Date().toISOString(),documents,source_at_start:await snapshot(base)};
  await mkdir(folder,{recursive:true});const file=join(folder,`${Date.now()}-${randomUUID()}.json`);await writeFile(file,JSON.stringify(receipt,null,2));const temp=join(folder,`${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(receipt,null,2));await rename(temp,head);return {id,status:'ready',documents:Object.keys(documents)};
 }
 if(command==='check'){
  const receipt=JSON.parse(await readFile(head,'utf8'));for(const [path,hash]of Object.entries(receipt.documents)){if(digest(await readFile(join(base,path)))!==hash)throw Error(`Design changed; re-finalize before further implementation: ${path}`);}return {id,status:'design-unchanged',documents:Object.keys(receipt.documents)};
 }
 throw Error('Use begin or check');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,id,...docs]=process.argv.slice(2);
 if(command==='diff'){if(!id)throw Error('diff requires a base Git revision');const paths=execFileSync('git',['diff','--name-only','--diff-filter=ACMR',`${id}...HEAD`],{cwd:root,encoding:'utf8'}).trim().split('\n');checkDesignDiff(paths);console.log('Design document diff present');}
 else console.log(JSON.stringify(await designGate(root,command,id,docs),null,2));
}
