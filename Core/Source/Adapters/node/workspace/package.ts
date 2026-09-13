import { Zip, ZipPassThrough, unzipSync } from 'fflate';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rm, rename, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { contained, manifest, portablePath, sha256, verifyAsset } from './assets.js';
import { atomicJson, locked, readJson } from './storage.js';
import { layout, snapshot } from './layout.js';
import { project } from '../../../Domain/schema.js';
import { parseDocument } from '../../../Domain/domain.js';
import { writeProjectViews } from './project-views.js';
import { historyFiles, initializeHistory, ensureHistory, listHistory, readRevision, writeRevision } from './history.js';
import type { Service } from '../../../Application/service.js';
export async function writeZip(output:string,files:{name:string;path?:string;bytes?:Uint8Array}[]){
 await mkdir(dirname(output),{recursive:true});const partial=output+'.'+randomUUID()+'.partial';const stream=createWriteStream(partial,{flags:'wx'});let failure:Error|undefined;stream.on('error',e=>{failure=e;});
 const done=once(stream,'finish');done.catch(()=>{});
 const zip=new Zip((error,data,final)=>{if(error){failure=error;stream.destroy(error);return;}stream.write(data);if(final)stream.end();});
 try{for(const file of files){if(failure)throw failure;portablePath(file.name);const entry=new ZipPassThrough(file.name);zip.add(entry);
  if(file.path){for await(const data of createReadStream(file.path)){entry.push(data as Buffer,false);if(stream.writableNeedDrain)await once(stream,'drain');if(failure)throw failure;}}
  else entry.push(file.bytes??new Uint8Array(),false);entry.push(new Uint8Array(),true);
 }zip.end();await done;if(failure)throw failure;await rename(partial,output);}catch(e){zip.terminate();stream.destroy();await rm(partial,{force:true});throw e;}
}
export async function exportBundle(service:Service,projectId:string,jobId:string,outputOverride?:string){
 return saveProject(service,projectId,{include_audio:true,output:outputOverride,job_id:jobId});
}
export interface BundleImportLimits { max_compressed_bytes?: number; max_expanded_bytes?: number; max_entry_bytes?: number }
function rejectUnsafeZipMetadata(bytes:Buffer){
 let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);--offset)if(bytes.readUInt32LE(offset)===0x06054b50&&offset+22+bytes.readUInt16LE(offset+20)===bytes.length){end=offset;break;}
 if(end<0)throw new Error('Invalid ZIP central directory');
 if(bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)throw new Error('Multi-volume ZIP is unsupported');
 const count=bytes.readUInt16LE(end+10);let offset=bytes.readUInt32LE(end+16);
 if(count===0xffff||offset===0xffffffff)throw new Error('ZIP64 import is not yet supported');
 for(let entry=0;entry<count;++entry){
  if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid ZIP entry metadata');
  if(((bytes.readUInt32LE(offset+38)>>>16)&0xf000)===0xa000)throw new Error('Symlink entries are not allowed');
  if(bytes.readUInt16LE(offset+8)&1)throw new Error('Encrypted ZIP entries are unsupported');
  offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
 }
 if(offset!==end)throw new Error('Invalid ZIP central directory length');
}
export async function importBundle(service:Service,path:string,projectId:string,limits:BundleImportLimits={}){
 const maxCompressed=limits.max_compressed_bytes??512*1024*1024,maxExpanded=limits.max_expanded_bytes??1024*1024*1024,maxEntry=limits.max_entry_bytes??512*1024*1024;
 if([maxCompressed,maxExpanded,maxEntry].some(value=>!Number.isSafeInteger(value)||value<=0))throw new Error('Invalid bundle import resource budget');
 const destination=service.dir(projectId);const size=(await stat(path)).size;if(size>maxCompressed)throw new Error(`Bundle import compressed size exceeds configured resource budget (${maxCompressed} bytes; default 512 MiB)`);
 const bytes=await readFile(path);if(bytes.length>maxCompressed)throw new Error('Bundle grew beyond the configured resource budget');rejectUnsafeZipMetadata(bytes);
 let total=0;const seen=new Set<string>();const zip=unzipSync(bytes,{filter:f=>{portablePath(f.name);const key=f.name.normalize('NFC').toLowerCase();if(seen.has(key))throw new Error('Case/Unicode collision in bundle');seen.add(key);total+=f.originalSize;if(total>maxExpanded||f.originalSize>maxEntry)throw new Error('Bundle expansion limit exceeded');return true;}});
 const parse=(name:string)=>{if(!zip[name])throw new Error(`Missing ${name}`);return JSON.parse(Buffer.from(zip[name]).toString('utf8'));};
 const pkg=parse('package.json');if(pkg.schema_version===2)return importCurrentBundle(service,zip,pkg,projectId);
 if(pkg.schema_version!==1||!pkg.files||typeof pkg.files!=='object')throw new Error('Unknown package format');
 const {createHash}=await import('node:crypto');for(const [name,bytes]of Object.entries(zip)){if(name==='package.json')continue;
  if(!/^(project.json|manifest.json|state\/frozen.json|state\/catalog.snapshot.json|state\/mixer.json|assets\/(source|reference|artwork)\/[^/]+|state\/frozen\/[a-f0-9]{64}\.wav)$/.test(name))throw new Error('Unexpected package entry');
  if(pkg.files[name]!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Package hash mismatch');
 }for(const name of Object.keys(pkg.files))if(!zip[name])throw new Error('Missing listed package file');
 const p=project.parse({...parse('project.json').project,id:projectId,revision:0});
 const staged=join(service.paths.projects,`.import-${randomUUID()}`);await layout(staged);
 try{for(const[name,bytes]of Object.entries(zip)){if(name==='package.json'||name==='project.json')continue;await mkdir(dirname(join(staged,name)),{recursive:true});await writeFile(join(staged,name),bytes);}
  const m=await manifest(staged);for(const a of m.assets)await verifyAsset(staged,a);
  const frozen=parse('state/frozen.json');if(frozen.revision!==parse('project.json').project.revision)throw new Error('Frozen revision mismatch');
  for(const value of [frozen.master,...Object.values(frozen.tracks),...Object.values(frozen.instrument_prints)])await contained(staged,String(value));
  frozen.revision=0;await atomicJson(join(staged,'state','frozen.json'),frozen);await atomicJson(join(staged,'project.json'),{project:p,receipts:{}});await snapshot(staged,p,{kind:'bundle_import'});
  // mkdir is the no-overwrite gate on both Windows and macOS; final files are moved only into this owned directory.
  await mkdir(destination);try{for(const name of (await readdir(staged)).filter(name=>name!=='project.json'))await rename(join(staged,name),join(destination,name));await rename(join(staged,'project.json'),join(destination,'project.json'));}catch(e){await rm(destination,{recursive:true,force:true});throw e;}
  return {project_id:projectId,revision:0,frozen_audio:true,plugins_checked:false};
 }finally{await rm(staged,{recursive:true,force:true});}
}

type BundleFile = { name: string; path?: string; bytes?: Uint8Array };
const digestBytes = async (bytes: Uint8Array) => (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
export function projectFilename(name: string, _kind: string) {
 const clean=name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/[. ]+$/g,'').slice(0,160)||'project';
 const safe=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(clean)?'_'+clean:clean;
 return `${safe}.aidaw.zip`;
}
/** Save editable state and all retained generations, without requiring a render. */
export async function saveProject(service:Service,projectId:string,options:{include_audio?:boolean;output?:string;job_id?:string}={}) {
 const dir=service.dir(projectId);
 const prepared=await locked(join(dir,'temp','project.lock'),async()=>{
  const envelope=await readJson(join(dir,'project.json')),p=parseDocument(envelope.project),kind='kind'in p?p.kind:'composition';
  if(!envelope.history){envelope.history=await ensureHistory(dir,p);await atomicJson(join(dir,'project.json'),envelope);}
  await writeProjectViews(dir,p);
  const files:BundleFile[]=[],hashes:Record<string,string>={},sizes:Record<string,number>={};
  const addBytes=async(name:string,bytes:Uint8Array)=>{portablePath(name);if(files.some(f=>f.name===name))return;files.push({name,bytes});hashes[name]=await digestBytes(bytes);sizes[name]=bytes.length;};
  const addJson=async(name:string,data:any)=>addBytes(name,Buffer.from(JSON.stringify(data)));
  const addPath=async(name:string,path:string)=>{portablePath(name);if(files.some(f=>f.name===name))return;if((await lstat(path)).isSymbolicLink())throw new Error('Symlink files cannot be bundled');files.push({name,path});hashes[name]=await sha256(path);sizes[name]=(await stat(path)).size;};
  const m=await manifest(dir);
  for(const asset of m.assets)await addPath(asset.path,await verifyAsset(dir,asset));
  for(const name of await historyFiles(dir))await addPath(name,await contained(dir,name));
  // Copy mutable read models while holding the project lock. Canonical history is authoritative.
  const includeViews=async(relative:string)=>{let entries;try{entries=await readdir(join(dir,relative),{withFileTypes:true});}catch(error:any){if(error.code==='ENOENT')return;throw error;}for(const entry of entries){const name=`${relative}/${entry.name}`;if(entry.isSymbolicLink())throw new Error('Symlink files cannot be bundled');if(entry.isDirectory())await includeViews(name);else if(entry.isFile()&&entry.name.endsWith('.json'))await addBytes(name,await readFile(await contained(dir,name)));}};
  await includeViews('state/memory');await includeViews(`state/${kind}`);
  try{await addBytes('AGENTS.md',await readFile(await contained(dir,'AGENTS.md')));}catch(error:any){if(error.code!=='ENOENT')throw error;}
  await addJson('project.json',{...envelope,project:p,receipts:{}});
  await addJson('manifest.json',m);
  let frozenAudio=false;
  if(options.job_id){
   const job=await service.jobStatus(options.job_id);
   if(job.scope!=='project'||job.state!=='succeeded'||job.project_id!==projectId||job.revision!==p.revision||!job.output)throw new Error('Bundle needs a successful render of the current revision');
   const freeze=async(path:string)=>{const name=`state/frozen/${await sha256(path)}.wav`;await addPath(name,path);return name;};
   const frozen:any={revision:p.revision,master:await freeze(job.output),tracks:{},instrument_prints:{},sample_rate:48000};
   for(const[id,stem]of Object.entries(job.stems??{}))frozen.tracks[id]=await freeze(stem.output);
   for(const[id,path]of Object.entries(job.instrument_prints??{}))frozen.instrument_prints[id]=await freeze(path);
   await addJson('state/frozen.json',frozen);if(job.mixer)await addJson('state/mixer.json',job.mixer);frozenAudio=true;
  }else if(options.include_audio){
   try{const frozen=await readJson(join(dir,'state','frozen.json'));if(frozen.revision===p.revision){for(const value of [frozen.master,...Object.values(frozen.tracks??{}),...Object.values(frozen.instrument_prints??{})])if(value)await addPath(String(value),await contained(dir,String(value)));await addJson('state/frozen.json',frozen);frozenAudio=true;}}catch(error:any){if(error.code!=='ENOENT')throw error;}
  }
  const selected=new Set<string>();const visit=(value:any)=>{if(!value||typeof value!=='object')return;if(value.kind==='plugin'&&typeof value.plugin_id==='string')selected.add(value.plugin_id);for(const item of Object.values(value))visit(item);};visit(p);
  const catalog=await service.catalog();await addJson('state/catalog.snapshot.json',{schema_version:1,plugins:catalog.plugins.filter(x=>selected.has(x.plugin_id)).map(({location,...x})=>x)});
  await addJson('package.json',{schema_version:2,format:'aidaw',kind,revision:p.revision,head:envelope.history,files:hashes,sizes,external_dependencies:'Plugin binaries, licenses and sample libraries are not bundled.',frozen_audio:frozenAudio});
  return{files,revision:p.revision,kind,frozenAudio,output:options.output??join(dir,'outputs','project',projectFilename(p.name,kind))};
 });
 await writeZip(prepared.output,prepared.files);
 return {output:prepared.output,sha256:await sha256(prepared.output),revision:prepared.revision,kind:prepared.kind,format:'aidaw',history:true,frozen_audio:prepared.frozenAudio};
}

async function importCurrentBundle(service:Service,zip:Record<string,Uint8Array>,pkg:any,projectId:string){
 if(pkg.format!=='aidaw'||!['composition','mastering','separation'].includes(pkg.kind)||!pkg.files||typeof pkg.files!=='object'||!pkg.sizes||typeof pkg.sizes!=='object')throw new Error('Unknown package format');
 const permitted=/^(project\.json|manifest\.json|AGENTS\.md|state\/(frozen|catalog\.snapshot|mixer)\.json|assets\/(source|reference|artwork)\/[^/]+|state\/frozen\/[a-f0-9]{64}\.wav|state\/history\/(revisions|checkpoints)\/\d+\.json|state\/history\/objects\/[a-f0-9]{64}|state\/(memory|composition|mastering|separation)\/(?:[^/]+\/)*[^/]+\.json)$/;
 for(const[name,bytes]of Object.entries(zip)){
  if(name==='package.json')continue;portablePath(name);
  if(!permitted.test(name))throw new Error(`Unexpected package entry: ${name}`);
  if(!Object.prototype.hasOwnProperty.call(pkg.files,name)||pkg.files[name]!==await digestBytes(bytes)||pkg.sizes[name]!==bytes.length)throw new Error('Package hash or size mismatch');
 }
 for(const name of Object.keys(pkg.files))if(name==='package.json'||!zip[name])throw new Error('Missing listed package file');
 const parse=(name:string)=>{if(!zip[name])throw new Error(`Missing ${name}`);return JSON.parse(Buffer.from(zip[name]).toString('utf8'));};
 const envelope=parse('project.json'),original=parseDocument(envelope.project);
 if(('kind'in original?original.kind:'composition')!==pkg.kind||original.revision!==pkg.revision||JSON.stringify(envelope.history)!==JSON.stringify(pkg.head))throw new Error('Package project metadata mismatch');
 const destination=service.dir(projectId),staged=join(service.paths.projects,`.import-${randomUUID()}`);await layout(staged,pkg.kind);
 try{
  for(const[name,bytes]of Object.entries(zip)){if(name==='package.json')continue;await mkdir(dirname(join(staged,name)),{recursive:true});await writeFile(join(staged,name),bytes);}
  const m=await manifest(staged);for(const asset of m.assets)await verifyAsset(staged,asset);
  const history=await listHistory(staged,0,1000);await historyFiles(staged);
  // Check every retained revision, including those not selected in the current document.
  const first=history.head_revision-history.total+1;
  const rebased=join(staged,'temp','rebase');let previous:any,newHead:any;
  for(let revision=first;revision<=history.head_revision;++revision){
   const value=parseDocument(await readRevision(staged,revision));
   if(('kind'in value?value.kind:'composition')!==pkg.kind)throw new Error('History changes project kind');
   const checkSources=(v:any)=>{if(!v||typeof v!=='object')return;if(v.kind==='audio'){const a=m.assets.find(a=>a.id===v.asset_id);if(!a||a.role==='reference'||a.role==='artwork')throw new Error('Historical source asset missing or invalid');}for(const child of Object.values(v))checkSources(child);};checkSources(value);
   const moved=parseDocument({...value,id:projectId});
   const commit=await readJson(join(staged,'state','history','revisions',`${revision}.json`));
   const metadata={request_id:commit.request_id,summary:commit.summary,kind:commit.kind,restored_from_revision:commit.restored_from_revision,created_at:commit.created_at};
   if(!previous)newHead=await initializeHistory(rebased,moved,metadata);
   else newHead=await writeRevision(rebased,previous,moved,metadata);
   previous=moved;
  }
  await rm(join(staged,'state','history'),{recursive:true});await rename(join(rebased,'state','history'),join(staged,'state','history'));await rm(rebased,{recursive:true,force:true});
  await atomicJson(join(staged,'project.json'),{...envelope,project:previous,history:newHead,receipts:{},origin_project_id:envelope.origin_project_id??original.id});
  await writeProjectViews(staged,previous);
  const frozen=zip['state/frozen.json']?parse('state/frozen.json'):undefined;
  if(frozen){if(frozen.revision!==original.revision)throw new Error('Frozen revision mismatch');for(const value of [frozen.master,...Object.values(frozen.tracks??{}),...Object.values(frozen.instrument_prints??{})])if(value)await contained(staged,String(value));}
  // mkdir is the no-overwrite gate. A failed import never deletes a pre-existing project.
  await mkdir(destination);
  try{for(const name of (await readdir(staged)).filter(name=>name!=='project.json'))await rename(join(staged,name),join(destination,name));await rename(join(staged,'project.json'),join(destination,'project.json'));}catch(error){await rm(destination,{recursive:true,force:true});throw error;}
  return{project_id:projectId,revision:previous.revision,kind:pkg.kind,history:true,retained_revisions:history.total,frozen_audio:!!frozen,plugins_checked:false};
 }finally{await rm(staged,{recursive:true,force:true});}
}
