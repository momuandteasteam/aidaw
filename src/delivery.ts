import { randomUUID } from 'node:crypto';
import { exportMidi } from './midi.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, rename, writeFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { atomicJson, locked, readJson } from './storage.js';
import { contained, sha256, portablePath } from './assets.js';
import { writeZip, exportBundle } from './package.js';
import type { Service } from './service.js';
const run=promisify(execFile);
export const tags=z.object({title:z.string().max(200),album:z.string().max(200).default(''),artist:z.string().max(200).default(''),album_artist:z.string().max(200).default(''),composer:z.string().max(200).default(''),genre:z.string().max(80).default(''),year:z.string().regex(/^[0-9]{4}$/).optional(),track:z.number().int().min(1).max(999).optional(),track_total:z.number().int().min(1).max(999).optional()}).strict();
interface Entry{path:string;source:string;sha256:string;bytes:number}
async function exists(path:string){try{await stat(path);return true;}catch(e:any){if(e.code==='ENOENT')return false;throw e;}}
export async function recover(dir:string){
 const journal=join(dir,'temp','publish.json');if(!await exists(journal))return;
 const j=await readJson(journal);for(const e of j.entries){portablePath(e.path);if(!/^(WAV|MP3|stems|MIDI|project|reports)\/[^/]+$/.test(e.path))throw new Error('Unsafe publication path');const dest=join(dir,'outputs',e.path);if(e.previous){await mkdir(dirname(dest),{recursive:true});await copyFile(await contained(dir,e.previous),dest);}else await rm(dest,{force:true});}
 if(j.previous_manifest)await atomicJson(join(dir,'outputs','manifest.json'),j.previous_manifest);else await rm(join(dir,'outputs','manifest.json'),{force:true});
 await rm(journal,{force:true});
}
export async function publish(service:Service,projectId:string,jobId:string,metadata:z.infer<typeof tags>,mp3:boolean,artworkId?:string){
 const dir=service.dir(projectId);return locked(join(dir,'temp','publish.lock'),async()=>{
 await recover(dir);const p=await service.read(projectId),job=await service.jobStatus(jobId);
 if(job.scope!=='project'||job.state!=='succeeded'||job.project_id!==projectId||job.revision!==p.revision||!job.output)throw new Error('Publish requires a successful current-revision render');
 if(await sha256(job.output)!==job.sha256)throw new Error('Rendered master changed after completion');
 if(job.premaster&&job.stems){const check=await service.engine.call({command:'compare_audio',reference:job.premaster,paths:Object.values(job.stems).map(s=>s.output)});if(check.max_absolute_difference>1e-6)throw new Error('Stems changed after rendering');}
 if(p.tracks.length>1&&p.tracks.some(t=>!job.stems?.[t.id]||!job.instrument_prints?.[t.id]))throw new Error('Incomplete multitrack stem set');
 const jobDir=dirname(await service.findJob(jobId));const entries:Entry[]=[];
 const add=async(path:string,source:string)=>{entries.push({path,source,sha256:await sha256(source),bytes:(await stat(source)).size});};
 await add('WAV/master.wav',job.output);if(job.premaster)await add('WAV/premaster.wav',job.premaster);
 const twoMix=p.tracks.length===1&&p.tracks[0].instrument.kind==='audio'&&p.buses.length===0;
 if(!twoMix)for(const[id,v]of Object.entries(job.stems??{})){await add(`stems/${id}__${(v as any).role==='fx_return'?'return':'mix'}.wav`,v.output);if(job.instrument_prints?.[id])await add(`stems/${id}__instrument.wav`,job.instrument_prints[id]);}
 if(p.tracks.some(t=>t.notes.length)){
  const saved=join(jobDir,'artifacts','performance.mid');await writeFile(saved,exportMidi(p));await add('MIDI/performance.mid',saved);
  const notationProject=structuredClone(p);notationProject.tracks=notationProject.tracks.map(t=>({...t,notes:t.notes.filter(n=>n.purpose!=='keyswitch').map(n=>({...n,pitch:n.display_pitch??n.pitch}))}));
  const notationSaved=join(jobDir,'artifacts','notation.mid');await writeFile(notationSaved,exportMidi(notationProject));await add('MIDI/notation.mid',notationSaved);
 }
 const outputMp3=join(jobDir,'artifacts','preview.mp3');
 if(mp3){let artwork:string|undefined;if(artworkId){const {manifest,verifyAsset}=await import('./assets.js');const a=(await manifest(dir)).assets.find(a=>a.id===artworkId&&a.role==='artwork');if(!a)throw new Error('Unknown artwork asset');artwork=await verifyAsset(dir,a);}
  const args=['-v','error','-y','-i',job.output,...(artwork?['-i',artwork,'-map','0:a:0','-map','1:v:0','-c:v','copy','-disposition:v','attached_pic']:[]),'-c:a','libmp3lame','-b:a','320k','-id3v2_version','3'];
  const mapped:any={...metadata,date:metadata.year,track:metadata.track?`${metadata.track}${metadata.track_total?'/'+metadata.track_total:''}`:undefined};delete mapped.year;delete mapped.track_total;
  for(const[k,v]of Object.entries(mapped))if(v!==undefined)args.push('-metadata',`${k}=${v}`);args.push(outputMp3);
  await run(process.env.AIDAW_FFMPEG??'ffmpeg',args,{timeout:120000,maxBuffer:1024*1024});
  const probe=await run(process.env.AIDAW_FFPROBE??'ffprobe',['-v','error','-show_format','-show_streams','-of','json',outputMp3]);const info=JSON.parse(probe.stdout);
  for(const[k,v]of Object.entries(mapped))if(v&&!Object.entries(info.format.tags??{}).some(([key,val])=>key.toLowerCase()===k.toLowerCase()&&val===String(v)))throw new Error(`MP3 metadata mismatch: ${k}`);
  if(artwork&&!info.streams.some((s:any)=>s.disposition?.attached_pic===1))throw new Error('MP3 cover not embedded');await add('MP3/preview.mp3',outputMp3);
 }
 const bundle=await exportBundle(service,projectId,jobId,join(jobDir,'artifacts','project.aidaw.zip'));await add('project/project.aidaw.zip',bundle.output);
 if(job.mixer){const mixerPath=join(jobDir,'artifacts','mixer.json');await add('reports/mixer.json',mixerPath);}
 const report={schema_version:1,project_id:projectId,revision:p.revision,job_id:jobId,metadata,technical_status:'passed',listening_status:'not_assessed_by_export',stem_status:twoMix?'unavailable_from_two_mix':'included',stem_roles:Object.fromEntries(Object.entries(job.stems??{}).map(([id,s]:any)=>[id,s.role??'track'])),stem_import_gain_db:0,stem_alignment:'all begin at frame 0 and include identical tail length',audio_analysis:job.analysis};
 const reportPath=join(jobDir,'artifacts','delivery-report.json');await atomicJson(reportPath,report);await add('reports/delivery.json',reportPath);
 const release={...report,files:entries.map(({source,...e})=>e)};
 const zip=join(jobDir,'artifacts','delivery.zip');await writeZip(zip,[...entries.map(e=>({name:e.path,path:e.source})),{name:'manifest.json',bytes:Buffer.from(JSON.stringify(release))}]);await add('project/delivery.zip',zip);
 return locked(join(dir,'temp','project.lock'),async()=>{if((await service.read(projectId)).revision!==p.revision)throw new Error('Project changed during publication preparation; render current revision before publishing');return commitEntries(dir,jobId,entries,release);});
 });
}

async function commitEntries(dir:string,jobId:string,entries:Entry[],release:any){
 const previous=await exists(join(dir,'outputs','manifest.json'))?await readJson(join(dir,'outputs','manifest.json')):undefined;
 const union=[...new Set([...entries.map(e=>e.path),...(previous?.files??[]).map((e:any)=>e.path)])];
 const backups=[];for(let i=0;i<union.length;i++){const path=portablePath(union[i]);if(!/^(WAV|MP3|stems|MIDI|project|reports)\/[^/]+$/.test(path))throw new Error('Unsafe publication path');const dest=join(dir,'outputs',path);let prior:string|undefined;if(await exists(dest)){prior=`jobs/${jobId}/work/publish-backup-${i}`;await copyFile(dest,join(dir,prior));}backups.push({path,previous:prior});}
 await atomicJson(join(dir,'temp','publish.json'),{entries:backups,previous_manifest:previous});
 try{
  for(const e of entries){const dest=join(dir,'outputs',e.path);await mkdir(dirname(dest),{recursive:true});const temporary=dest+'.'+randomUUID()+'.tmp';try{await copyFile(e.source,temporary);if(await sha256(temporary)!==e.sha256)throw new Error('Published file verification failed');await rename(temporary,dest);}finally{await rm(temporary,{force:true});}}
  for(const path of union)if(!entries.some(e=>e.path===path))await rm(join(dir,'outputs',path),{force:true});
  await atomicJson(join(dir,'outputs','manifest.json'),{...release,files:entries.map(({source,...e})=>e)});await rm(join(dir,'temp','publish.json'),{force:true});
 }catch(e){await recover(dir);throw e;}
 return {output_directory:join(dir,'outputs'),manifest:join(dir,'outputs','manifest.json'),revision:release.revision,files:entries.length,stem_status:release.stem_status};
}

export async function publishBatch(service:Service,projectId:string,jobId:string,metadata:Record<string,z.infer<typeof tags>>,mp3:boolean){
 const dir=service.dir(projectId);return locked(join(dir,'temp','publish.lock'),async()=>{
  await recover(dir);const p=await service.read(projectId),job:any=await service.jobStatus(jobId);if(job.project_id!==projectId||job.revision!==p.revision||job.state!=='succeeded'||!job.tasks?.length)throw new Error('Batch publication needs a successful current-revision batch');
  const entries:Entry[]=[];const jobDir=dirname(await service.findJob(jobId));
  for(const task of job.tasks){if(task.state!=='succeeded'||await sha256(task.output)!==task.sha256)throw new Error('Invalid batch task output');
   entries.push({path:`WAV/${task.id}.wav`,source:task.output,sha256:task.sha256,bytes:(await stat(task.output)).size});
   if(mp3){const output=join(jobDir,'artifacts',`${task.id}.mp3`),meta=metadata[task.id]??tags.parse({title:task.id});
    const args=['-v','error','-y','-i',task.output,'-c:a','libmp3lame','-b:a','320k','-id3v2_version','3'];
    const mapped:any={...meta,date:meta.year,track:meta.track?`${meta.track}${meta.track_total?'/'+meta.track_total:''}`:undefined};delete mapped.year;delete mapped.track_total;
    for(const[k,v]of Object.entries(mapped))if(v!==undefined)args.push('-metadata',`${k}=${v}`);args.push(output);await run(process.env.AIDAW_FFMPEG??'ffmpeg',args,{timeout:120000,maxBuffer:1048576});
    const result=await run(process.env.AIDAW_FFPROBE??'ffprobe',['-v','error','-show_format','-of','json',output]);const saved=JSON.parse(result.stdout).format.tags??{};for(const[k,v]of Object.entries(mapped))if(v&&!Object.entries(saved).some(([key,val])=>key.toLowerCase()===k.toLowerCase()&&val===String(v)))throw new Error('Batch MP3 tag verification failed');
    entries.push({path:`MP3/${task.id}.mp3`,source:output,sha256:await sha256(output),bytes:(await stat(output)).size});
   }
  }
  const release={schema_version:1,project_id:projectId,revision:p.revision,job_id:jobId,stem_status:'unavailable_from_two_mix',listening_status:'pending',metadata,tasks:job.tasks.map((t:any)=>({id:t.id,source_asset:t.source_asset,source_sha256:t.source_sha256,analysis:t.analysis,ending_status:t.ending_status})),files:entries.map(({source,...e})=>e)};
  const report=join(jobDir,'artifacts','batch-delivery.json');await atomicJson(report,release);entries.push({path:'reports/delivery.json',source:report,sha256:await sha256(report),bytes:(await stat(report)).size});
  const zip=join(jobDir,'artifacts','batch-delivery.zip');await writeZip(zip,[...entries.map(e=>({name:e.path,path:e.source})),{name:'manifest.json',bytes:Buffer.from(JSON.stringify(release))}]);entries.push({path:'project/delivery.zip',source:zip,sha256:await sha256(zip),bytes:(await stat(zip)).size});
  return locked(join(dir,'temp','project.lock'),async()=>{if((await service.read(projectId)).revision!==p.revision)throw new Error('Project changed during publication preparation; render current revision before publishing');return commitEntries(dir,jobId,entries,release);});
 });
}
