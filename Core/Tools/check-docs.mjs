import {readFile,readdir,access} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function markdown(folder){const result=[];for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())result.push(...await markdown(path));else if(entry.name.endsWith('.md'))result.push(path);}return result;}
export async function checkDocs(root=defaultRoot){
 const manifest=JSON.parse(await readFile(join(root,'Docs/Development/documents.json'),'utf8'));
 if(manifest.version!==1||!Array.isArray(manifest.documents))throw new Error('Invalid document manifest');
 const errors=[],paths=new Set(),owners=new Set(),graph=new Map();let total=0;
 for(const doc of manifest.documents){
  if(paths.has(doc.path))errors.push(`Duplicate document: ${doc.path}`);paths.add(doc.path);
  if(!Number.isSafeInteger(doc.max_bytes)||doc.max_bytes<1)errors.push(`Invalid budget: ${doc.path}`);
  if(!['entry','workflow','architecture','contract','development','user'].includes(doc.role))errors.push(`Invalid role: ${doc.path}`);
  for(const owner of doc.owns??[]){if(owners.has(owner))errors.push(`Duplicate specification owner: ${owner}`);owners.add(owner);}
  let text;try{text=await readFile(join(root,doc.path),'utf8');}catch{errors.push(`Missing document: ${doc.path}`);continue;}
  const bytes=Buffer.byteLength(text);total+=bytes;if(bytes>doc.max_bytes)errors.push(`Reading budget exceeded: ${doc.path} (${bytes}/${doc.max_bytes} bytes)`);
  const prose=text.replace(/```[\s\S]*?```/g,'');const links=[];
  for(const match of prose.matchAll(/\]\(([^)]+)\)/g)){
   let target=match[1].replace(/^<|>$/g,'');if(/^[a-z]+:/i.test(target)||target.startsWith('#'))continue;
   target=target.split('#')[0].replace(/:\d+$/,'');if(!target)continue;
   const absolute=resolve(root,dirname(doc.path),target),rel=relative(root,absolute).replaceAll('\\','/');
   if(rel.startsWith('../')){errors.push(`Link escapes repository: ${doc.path} -> ${target}`);continue;}
   try{await access(absolute);}catch{errors.push(`Broken link: ${doc.path} -> ${target}`);}
   if(rel.endsWith('.md'))links.push(rel);
  }
  if(/(^|[\s`(])(?:src|native|player|scripts|packages|apps|adapters|docs)\//m.test(text))errors.push(`Obsolete source path: ${doc.path}`);
  graph.set(doc.path,links);
 }
 for(const folder of ['Docs','Workflows'])for(const file of await markdown(join(root,folder))){const path=relative(root,file).replaceAll('\\','/');if(!paths.has(path))errors.push(`Unregistered document: ${path}`);}
 const requirementPath='Docs/Development/REQUIREMENTS.md',verificationPath='Docs/Development/VERIFICATION.md';
 if(paths.has(requirementPath)&&paths.has(verificationPath)){
  const ids=async path=>{const text=await readFile(join(root,path),'utf8');return [...text.matchAll(/^\|\s*(R-\d{3})\s*\|/gm)].map(match=>match[1]);};
  const requirements=await ids(requirementPath),verification=await ids(verificationPath);
  if(!requirements.length)errors.push('No requirement IDs');
  for(const [name,values]of [['requirements',requirements],['verification',verification]])if(new Set(values).size!==values.length)errors.push(`Duplicate IDs in ${name}`);
  for(const id of requirements)if(!verification.includes(id))errors.push(`Missing verification row: ${id}`);
  for(const id of verification)if(!requirements.includes(id))errors.push(`Unowned verification row: ${id}`);
 }
 const seen=new Set(),pending=['AGENTS.md','CLAUDE.md','README.md'];while(pending.length){const p=pending.pop();if(seen.has(p))continue;seen.add(p);pending.push(...(graph.get(p)??[]));}
 for(const path of paths)if(!seen.has(path))errors.push(`No entry route to document: ${path}`);
 if(errors.length)throw new Error(errors.join('\n'));
 return {documents:paths.size,total_bytes:total,entry_bytes:Buffer.byteLength(await readFile(join(root,'AGENTS.md'),'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkDocs(),null,2));
