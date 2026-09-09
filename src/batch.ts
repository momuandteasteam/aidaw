import { join } from 'node:path';
import { z } from 'zod';
import { plugin, frame, id, audioInstrument, project } from './schema.js';
import { newJob } from './layout.js';
import { atomicJson, locked, readJson } from './storage.js';
import { inputAsset, sha256 } from './assets.js';
import type { Service } from './service.js';
export const batchTask=z.object({id,name:z.string().min(1).max(200),clip:audioInstrument,gain_db:z.number().min(-96).max(12).default(0),effects:z.array(plugin).max(16).default([]),tail_seconds:z.number().min(0).max(30).default(1),duration_frames:frame.optional()}).strict();
export async function batchRender(service:Service,projectId:string,tasks:z.infer<typeof batchTask>[],resumeId?:string,controller?:AbortController){
 const dir=service.dir(projectId);const job=resumeId?{id:resumeId,path:join(dir,'jobs',id.parse(resumeId))}:await newJob(dir,{kind:'batch_render',project_id:projectId,tasks});
 return locked(join(job.path,'work','batch.lock'),async()=>{
 let p=await service.read(projectId),status:any;
 if(resumeId){const request=await readJson(join(job.path,'request.json'));if(request.kind!=='batch_render')throw new Error('Not a batch render job');tasks=request.tasks;p=await readJson(join(job.path,'snapshots','input.json'));status=await readJson(join(job.path,'status.json'));}
 else{if(new Set(tasks.map(t=>t.id)).size!==tasks.length)throw new Error('Duplicate task IDs');await atomicJson(join(job.path,'snapshots','input.json'),p);status={id:job.id,project_id:projectId,revision:p.revision,state:'running',tasks:tasks.map(t=>({id:t.id,state:'pending',attempt:0}))};}
 status.state='running';status.owner_pid=process.pid;await atomicJson(join(job.path,'status.json'),status);
 for(const task of tasks){if(controller?.signal.aborted){status.state='cancelled';break;}const state=status.tasks.find((t:any)=>t.id===task.id);if(state.state==='succeeded'){if(await sha256(state.output).catch(()=>null)===state.sha256)continue;state.state='failed';}
  state.state='running';state.attempt++;await atomicJson(join(job.path,'status.json'),status);
  try{const {asset}=await inputAsset(dir,task.clip.asset_id);const end=task.clip.end_frame??String(asset.audio!.frames);const natural=BigInt(task.clip.timeline_frame)+BigInt(end)-BigInt(task.clip.start_frame);const frames=task.duration_frames??String(natural);if(BigInt(frames)<natural)throw new Error('Duration would truncate the clip; specify its end_frame explicitly');
   let snapshot=project.parse({...p,duration_frames:frames,tracks:[{id:task.id,name:task.name,instrument:task.clip,gain_db:task.gain_db,pan:0,notes:[],effects:[]}],buses:[],master_effects:task.effects});
   if(state.snapshot){snapshot=project.parse(await readJson(join(job.path,'snapshots',state.snapshot)));}else{await service.freezePlugins(snapshot,join(job.path,'work'));state.snapshot=`${task.id}__plan.json`;await atomicJson(join(job.path,'snapshots',state.snapshot),snapshot);await atomicJson(join(job.path,'status.json'),status);}
   const resolved=await service.resolvedProject(snapshot);const output=join(job.path,'artifacts',`${task.id}__attempt_${state.attempt}__master.wav`);
   await atomicJson(join(job.path,'snapshots',`${task.id}__attempt_${state.attempt}.json`),snapshot);
   const result=await service.engine.call({command:'render',project:resolved,output,tail_seconds:task.tail_seconds},{timeout:900000,workDir:join(job.path,'work'),signal:controller?.signal});
   await inputAsset(dir,task.clip.asset_id); // Verify source integrity again after processing.
   Object.assign(state,{state:'succeeded',output,sha256:await sha256(output),analysis:result.analysis,source_asset:asset.id,source_sha256:asset.sha256,stem_status:'unavailable_from_two_mix',ending_status:task.clip.end_frame?'explicit_clip_end':'full_source_end',listening_status:'pending'});delete state.error;
  }catch(e){state.state=controller?.signal.aborted?'cancelled':'failed';state.error=String(e);if(controller?.signal.aborted)status.state='cancelled';}
  await atomicJson(join(job.path,'status.json'),status);
 }
 if(status.state!=='cancelled')status.state=status.tasks.every((t:any)=>t.state==='succeeded')?'succeeded':'failed';await atomicJson(join(job.path,'status.json'),status);return status;
 });
}

export async function startBatch(service:Service,projectId:string,tasks:z.infer<typeof batchTask>[],resumeId?:string){
 const dir=service.dir(projectId);let job:{id:string,path:string};
 if(resumeId){job={id:resumeId,path:join(dir,'jobs',id.parse(resumeId))};const old=await readJson(join(job.path,'status.json'));if(old.state==='running'||old.state==='queued')throw new Error('Batch is already running');}
 else{if(new Set(tasks.map(t=>t.id)).size!==tasks.length)throw new Error('Duplicate task IDs');job=await newJob(dir,{kind:'batch_render',project_id:projectId,tasks});const p=await service.read(projectId);await atomicJson(join(job.path,'snapshots','input.json'),p);await atomicJson(join(job.path,'status.json'),{id:job.id,project_id:projectId,revision:p.revision,state:'queued',owner_pid:process.pid,tasks:tasks.map(t=>({id:t.id,state:'pending',attempt:0}))});}
 const controller=new AbortController();const done=service.processing.run('batch_render',()=>batchRender(service,projectId,[],job.id,controller),{id:job.id,signal:controller.signal}).then(()=>{}).catch(async e=>{const previous=await readJson(join(job.path,'status.json'));await atomicJson(join(job.path,'status.json'),{...previous,state:controller.signal.aborted?'cancelled':'failed',error:String(e)});});
 service.trackBackground(job.id,controller,done);return {job_id:job.id,state:service.processing.status().active?.id===job.id?'running':'queued'};
}
