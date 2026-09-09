import { Zip, ZipPassThrough, unzipSync } from 'fflate';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rm, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { contained, manifest, portablePath, sha256, verifyAsset } from './assets.js';
import { atomicJson } from './storage.js';
import { layout, snapshot } from './layout.js';
import { project } from './schema.js';
import type { Service } from './service.js';
export async function writeZip(output:string,files:{name:string;path?:string;bytes?:Uint8Array}[]){
 await mkdir(dirname(output),{recursive:true});const partial=output+'.partial';const stream=createWriteStream(partial,{flags:'wx'});let failure:Error|undefined;stream.on('error',e=>{failure=e;});
 const done=once(stream,'finish');done.catch(()=>{});
 const zip=new Zip((error,data,final)=>{if(error){failure=error;stream.destroy(error);return;}stream.write(data);if(final)stream.end();});
 try{for(const file of files){if(failure)throw failure;portablePath(file.name);const entry=new ZipPassThrough(file.name);zip.add(entry);
  if(file.path){for await(const data of createReadStream(file.path)){entry.push(data as Buffer,false);if(stream.writableNeedDrain)await once(stream,'drain');if(failure)throw failure;}}
  else entry.push(file.bytes??new Uint8Array(),false);entry.push(new Uint8Array(),true);
 }zip.end();await done;if(failure)throw failure;await rename(partial,output);}catch(e){zip.terminate();stream.destroy();await rm(partial,{force:true});throw e;}
}
export async function exportBundle(service:Service,projectId:string,jobId:string,outputOverride?:string){
 const p=await service.read(projectId),dir=service.dir(projectId),job=await service.jobStatus(jobId);
 if(job.scope!=='project'||job.state!=='succeeded'||job.project_id!==projectId||job.revision!==p.revision||!job.output)throw new Error('Bundle needs a successful render of the current revision');
 const m=await manifest(dir), files:{name:string;path?:string;bytes?:Uint8Array}[]=[], hashes:Record<string,string>={};
 const add=async(name:string,path:string)=>{if(files.some(f=>f.name===name))return;files.push({name,path});hashes[name]=await sha256(path);};
 for(const a of m.assets)await add(a.path,await verifyAsset(dir,a));
 const frozen:any={revision:p.revision,master:'',tracks:{},instrument_prints:{},sample_rate:48000};
 const freeze=async(path:string)=>{const name=`state/frozen/${await sha256(path)}.wav`;if(!files.some(f=>f.name===name))await add(name,path);return name;};
 frozen.master=await freeze(job.output);for(const [id,v]of Object.entries(job.stems??{}))frozen.tracks[id]=await freeze(v.output);
 for(const [id,path]of Object.entries(job.instrument_prints??{}))frozen.instrument_prints[id]=await freeze(path);
 const selected=new Set([...p.tracks.flatMap(t=>[...(t.instrument.kind==='plugin'?[t.instrument.plugin_id]:[]),...t.effects.map(f=>f.plugin_id)]),...p.master_effects.map(f=>f.plugin_id),...p.buses.flatMap(b=>b.effects.map(f=>f.plugin_id))]);
 const catalog=await service.catalog();const catalogSnapshot={schema_version:1,plugins:catalog.plugins.filter(x=>selected.has(x.plugin_id)).map(({description_xml,location,...x})=>x)};
 for(const [name,data]of Object.entries({'project.json':{project:p,receipts:{}},'manifest.json':m,'state/frozen.json':frozen,'state/catalog.snapshot.json':catalogSnapshot,...(job.mixer?{'state/mixer.json':job.mixer}:{})})){const bytes=Buffer.from(JSON.stringify(data));files.push({name,bytes});const {createHash}=await import('node:crypto');hashes[name]=createHash('sha256').update(bytes).digest('hex');}
 files.push({name:'package.json',bytes:Buffer.from(JSON.stringify({schema_version:1,files:hashes,external_dependencies:'Plugin binaries, licenses and sample libraries are not bundled. Frozen audio is included.'}))});
 const output=outputOverride??join(dir,'outputs','project','project.aidaw.zip');await writeZip(output,files);return {output,sha256:await sha256(output),revision:p.revision,frozen_audio:true};
}
export async function importBundle(service:Service,path:string,projectId:string){
 const destination=service.dir(projectId);const size=(await stat(path)).size;if(size>512*1024*1024)throw new Error('Bundle import currently limited to 512 MiB compressed');
 let total=0;const seen=new Set<string>();const zip=unzipSync(await readFile(path),{filter:f=>{portablePath(f.name);const key=f.name.normalize('NFC').toLowerCase();if(seen.has(key))throw new Error('Case/Unicode collision in bundle');seen.add(key);total+=f.originalSize;if(total>1024*1024*1024||f.originalSize>512*1024*1024)throw new Error('Bundle expansion limit exceeded');return true;}});
 const parse=(name:string)=>{if(!zip[name])throw new Error(`Missing ${name}`);return JSON.parse(Buffer.from(zip[name]).toString('utf8'));};
 const pkg=parse('package.json');if(pkg.schema_version!==1||!pkg.files||typeof pkg.files!=='object')throw new Error('Unknown package format');
 const {createHash}=await import('node:crypto');for(const [name,bytes]of Object.entries(zip)){if(name==='package.json')continue;
  if(!/^(project.json|manifest.json|state\/frozen.json|state\/catalog.snapshot.json|state\/mixer.json|assets\/(source|reference|artwork)\/[^/]+|state\/frozen\/[a-f0-9]{64}\.wav)$/.test(name))throw new Error('Unexpected package entry');
  if(pkg.files[name]!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Package hash mismatch');
 }for(const name of Object.keys(pkg.files))if(!zip[name])throw new Error('Missing listed package file');
 const p=project.parse({...parse('project.json').project,id:projectId,revision:0});
 const staged=join(service.root,'projects',`.import-${randomUUID()}`);await layout(staged);
 try{for(const[name,bytes]of Object.entries(zip)){if(name==='package.json'||name==='project.json')continue;await mkdir(dirname(join(staged,name)),{recursive:true});await writeFile(join(staged,name),bytes);}
  const m=await manifest(staged);for(const a of m.assets)await verifyAsset(staged,a);
  const frozen=parse('state/frozen.json');if(frozen.revision!==parse('project.json').project.revision)throw new Error('Frozen revision mismatch');
  for(const value of [frozen.master,...Object.values(frozen.tracks),...Object.values(frozen.instrument_prints)])await contained(staged,String(value));
  frozen.revision=0;await atomicJson(join(staged,'state','frozen.json'),frozen);await atomicJson(join(staged,'project.json'),{project:p,receipts:{}});await snapshot(staged,p,{kind:'bundle_import'});
  // mkdir is the no-overwrite gate on both Windows and macOS; final files are moved only into this owned directory.
  await mkdir(destination);try{for(const name of await (await import('node:fs/promises')).readdir(staged))await rename(join(staged,name),join(destination,name));}catch(e){await rm(destination,{recursive:true,force:true});throw e;}
  return {project_id:projectId,revision:0,frozen_audio:true,plugins_checked:false};
 }finally{await rm(staged,{recursive:true,force:true});}
}
