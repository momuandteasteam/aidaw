import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
const run=promisify(execFile);
export const downloadOptions=z.object({format:z.enum(['wav','flac','mp3']).default('wav'),sample_rate:z.union([z.literal(44100),z.literal(48000),z.literal(88200),z.literal(96000)]).default(48000),bit_depth:z.union([z.literal(16),z.literal(24),z.literal(32)]).default(24),bitrate_kbps:z.union([z.literal(128),z.literal(192),z.literal(256),z.literal(320)]).default(320)}).strict().superRefine((v,c)=>{if(v.format==='mp3'&&v.sample_rate>48000)c.addIssue({code:'custom',message:'MP3 supports 44.1/48 kHz'});if(v.format==='flac'&&v.bit_depth===32)c.addIssue({code:'custom',message:'FLAC supports 16/24 bit'});});
import {mkdir,copyFile} from 'node:fs/promises';
import {sha256} from '../Adapters/node/workspace/assets.js';
import {resolveMasteringTarget} from '../Domain/domain.js';
import {completedVersionAudio} from './mastering-preview.js';
import {join} from 'node:path';
import {newJob} from '../Adapters/node/workspace/layout.js';
import {atomicJson} from '../Adapters/node/workspace/storage.js';
import {prepareComparison} from './mastering-preview.js';
import type {Service} from './service.js';
const requests=new WeakMap<Service,Map<string,Promise<any>>>();
/** A frozen project snapshot is prepared on the same lane as playback and export. */
export async function startMasteringPreparation(service:Service,projectId:string){
 const doc:any=await service.readDocument(projectId);
 if(doc.kind!=='mastering')return {state:'skipped',reason:'not_mastering'};
 const engine=await service.engine.describe();
 if(!engine.features.includes('playback.prepared_comparison.v1'))return {state:'skipped',reason:'unsupported_engine'};
 let map=requests.get(service);if(!map){map=new Map();requests.set(service,map);}
 const key=JSON.stringify([doc.id,doc.revision,engine.content_fingerprint]);
 if(map.has(key))return map.get(key);
 const pending=(async()=>{
  const job=await newJob(service.dir(doc.id),{kind:'mastering_prepare',project_id:doc.id,revision:doc.revision});
  const controller=new AbortController();
  const status:any={id:job.id,kind:'mastering_prepare',project_id:doc.id,revision:doc.revision,owner_pid:process.pid,state:'queued',completed:0,total:doc.mastering.songs.length,skipped:[]};
  const persist=()=>atomicJson(join(job.path,'status.json'),status);await persist();
  const done=(async()=>{
   try{await service.processing.enqueue('mastering_prepare',async()=>{
    status.state='running';await persist();
    for(const song of doc.mastering.songs){
     if(controller.signal.aborted)throw Error('Preparation cancelled');
     // Prepare the editing version even when neither comparison slot points at it yet.
     let edit;for(const version of song.versions){const current=structuredClone(doc),copy=current.mastering.songs.find((s:any)=>s.id===song.id);
     copy.comparison={a:{kind:'version',version_id:version.id},b:{kind:'version',version_id:version.id}};
     edit=await prepareComparison(service,current,{song_id:song.id,comparison:'b'},controller.signal);}
     const pair=await prepareComparison(service,doc,{song_id:song.id,comparison:'b'},controller.signal);
     if(!edit||!pair)status.skipped.push(song.id);
     status.completed++;await persist();
    }
    status.state=status.skipped.length?'skipped':'succeeded';
   },{id:job.id,signal:controller.signal});}
   catch(error){status.state=controller.signal.aborted?'cancelled':'failed';status.error=String(error);}
   finally{await persist();if(status.state!=='succeeded')map!.delete(key);}
  })();
  service.trackBackground(job.id,controller,done);
  return {job_id:job.id,project_id:doc.id,revision:doc.revision,state:'queued'};
 })();
 map.set(key,pending);if(map.size>64)map.delete(map.keys().next().value!);
 try{return await pending;}catch(error){map.delete(key);throw error;}
}

export async function downloadMastering(service:Service,args:any){
 const doc:any=await service.workspace.readRevision(args.project_id,args.revision);
 const target=resolveMasteringTarget(doc,args);
 let cached=await completedVersionAudio(service,doc,args);
 if(!cached){
  const copy=structuredClone(doc),song=copy.mastering.songs.find((s:any)=>s.id===target.song.id);
  song.comparison={a:target.selection,b:target.selection};
  await service.processing.enqueue('mastering_download_prepare',()=>prepareComparison(service,copy,{song_id:song.id,comparison:'b'},new AbortController().signal));
  cached=await completedVersionAudio(service,doc,args);
 }
 if(!cached)throw Error('This selection cannot be pre-rendered by the current engine or exceeds the preview limit');
 const dir=join(service.dir(doc.id),'outputs','songs');await mkdir(dir,{recursive:true});
 const options=downloadOptions.parse(args.options??{}),output=join(dir,`${target.song.id}_${target.version.id}_${randomUUID()}.${options.format}`);
 const codec=options.format==='mp3'?'libmp3lame':options.format==='flac'?'flac':options.bit_depth===32?'pcm_f32le':`pcm_s${options.bit_depth}le`;
 await service.processing.enqueue('mastering_download_encode',async()=>{
  const pcm=options.format!=='mp3';
  await run(process.env.AIDAW_FFMPEG??'ffmpeg',['-v','error','-y','-i',cached!.path,'-map','0:a:0','-af',`aresample=${options.sample_rate}:filter_size=64:phase_shift=10:exact_rational=1${pcm&&options.bit_depth!==32?':dither_method=triangular:output_sample_bits='+options.bit_depth:''}`,'-c:a',codec,...(options.format==='mp3'?['-b:a',`${options.bitrate_kbps}k`]:options.format==='flac'?['-sample_fmt',options.bit_depth===16?'s16':'s32','-bits_per_raw_sample',String(options.bit_depth)]:[]),output],{timeout:120000,signal:service.processing.signal,maxBuffer:1048576});
 },{});
 const probe=JSON.parse((await run(process.env.AIDAW_FFPROBE??'ffprobe',['-v','error','-show_streams','-of','json',output],{timeout:30000,maxBuffer:1048576})).stdout).streams.find((s:any)=>s.codec_type==='audio');
 if(!probe||Number(probe.sample_rate)!==options.sample_rate||probe.channels!==2||probe.codec_name!==(options.format==='mp3'?'mp3':codec))throw Error('Download format verification failed');
 if(options.format!=='mp3'&&Number(probe.bits_per_raw_sample||probe.bits_per_sample)!==options.bit_depth)throw Error('Download bit depth verification failed');
 return {output,sha256:await sha256(output),revision:args.revision,song_id:target.song.id,version_id:target.version.id,selection:target.selection,...options};
}
