import { copyFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { manifest, sha256, portablePath } from './assets.js';
import { locked, atomicJson, readJson } from './storage.js';
import { newJob } from './layout.js';
import type { Service } from './service.js';
export async function relink(service:Service,projectId:string,assetId:string,path:string){
 const dir=service.dir(projectId);return locked(join(dir,'temp','assets.lock'),async()=>{
 const a=(await manifest(dir)).assets.find(a=>a.id===assetId);if(!a)throw new Error('Unknown asset');if(await sha256(path)!==a.sha256)throw new Error('Relink requires exactly the original bytes');
 const job=await newJob(dir,{kind:'asset_relink',asset_id:assetId});await copyFile(path,join(dir,portablePath(a.path)));if(await sha256(join(dir,a.path))!==a.sha256)throw new Error('Relink copy failed verification');await atomicJson(join(job.path,'status.json'),{state:'succeeded',asset_id:assetId});return {asset_id:assetId,restored:true};
 });
}
export async function cleanWork(service:Service,projectId:string,dryRun:boolean){
 const dir=service.dir(projectId);return locked(join(dir,'temp','publish.lock'),async()=>{
 try{await stat(join(dir,'temp','publish.json'));throw new Error('Recover publication before cleanup');}catch(e:any){if(e.code!=='ENOENT')throw e;}
 const files:string[]=[];let bytes=0;for(const name of await readdir(join(dir,'jobs'))){
  let status:any;try{status=await readJson(join(dir,'jobs',name,'status.json'));}catch{continue;}if(status.state!=='succeeded')continue;
  const work=join(dir,'jobs',name,'work');for(const file of await readdir(work)){const path=join(work,file),s=await stat(path);if(s.isFile()){files.push(path);bytes+=s.size;}}
 }
 if(!dryRun)for(const file of files)await rm(file);return {dry_run:dryRun,files,bytes,retained:'all assets, frozen audio, snapshots, artifacts, failed/pending jobs and publication journals'};
 });
}
