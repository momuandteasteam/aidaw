import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
export const folders = ['assets/source','assets/reference','assets/artwork','state/plugins','state/midi','state/frozen','jobs','outputs/WAV','outputs/MP3','outputs/stems','outputs/MIDI','outputs/project','outputs/reports','temp'];
export async function layout(dir: string) { for (const d of folders) await mkdir(join(dir,d),{recursive:true}); }
export async function newJob(dir: string, request: unknown, jobId: string = randomUUID()) {
  await layout(dir);
  const path=join(dir,'jobs',jobId); await mkdir(path,{recursive:true});
  for(const d of ['snapshots','work','artifacts','logs']) await mkdir(join(path,d),{recursive:true});
  await atomicJson(join(path,'request.json'),request);
  await atomicJson(join(path,'plan.json'),request);
  await atomicJson(join(path,'status.json'),{id:jobId,state:'running',owner_pid:process.pid,created_at:new Date().toISOString()});return {id:jobId,path};
}
export async function snapshot(dir: string,p: {revision:number},request:unknown) {
 const job=await newJob(dir,request); await atomicJson(join(job.path,'snapshots','after.json'),p);
 await atomicJson(join(job.path,'status.json'),{id:job.id,state:'succeeded',revision:p.revision}); return job;
}
export async function revisionSnapshot(dir:string,revision:number) {
 const current=await readJson(join(dir,'project.json'));if(current.project.revision===revision)return current.project;
 const receipt:any=Object.values(current.receipts??{}).find((r:any)=>r.revision===revision&&r.job_id);if(receipt)return readJson(join(dir,'jobs',receipt.job_id,'snapshots','after.json'));
 let names:string[]=[];try{names=await readdir(join(dir,'jobs'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
 for(const name of names) {
  try { const status=await readJson(join(dir,'jobs',name,'status.json'));if(status.state!=='succeeded')continue;const p=await readJson(join(dir,'jobs',name,'snapshots','after.json')); if(p.revision===revision)return p; } catch(e:any){if(e.code!=='ENOENT')throw e;}
 }
 // Legacy read compatibility; never move or discard the old project implicitly.
 return readJson(join(dir,'revisions',`${revision}.json`));
}
