import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {id} from '../Domain/schema.js';
import {manifest,verifyAsset,ingest,sha256} from '../Adapters/node/workspace/assets.js';
import {atomicJson,locked,readJson} from '../Adapters/node/workspace/storage.js';
import {newJob} from '../Adapters/node/workspace/layout.js';
import {writeZip} from '../Adapters/node/workspace/package.js';
import type {Service} from './service.js';
const run=promisify(execFile);
export const separationRequest=z.object({project_id:id,source_asset_id:z.string().min(1),base_revision:z.number().int().nonnegative(),request_id:id}).strict();
export const separationExportRequest=z.object({project_id:id,request_id:id,revision:z.number().int().nonnegative(),kind:z.enum(['stems','mix']),format:z.enum(['wav','mp3','flac']).default('wav')}).strict();
async function ffmpeg(args:string[],signal:AbortSignal){return run(process.env.AIDAW_FFMPEG??'ffmpeg',['-v','error','-nostdin','-y',...args],{signal,timeout:7200000,maxBuffer:1024*1024});}
async function audioInfo(service:Service,path:string){const a:any=await service.engine.analyze({path});if(!Number.isFinite(a.sample_peak)||!Number.isFinite(a.duration_seconds)||a.duration_seconds<=0||a.duration_seconds>1800)throw Error('Invalid audio or duration exceeds 30 minutes');return a;}
async function launch(service:Service,args:any,kind:string,work:(job:any,status:any,signal:AbortSignal)=>Promise<void>){
 const dir=service.dir(args.project_id);return locked(join(dir,'temp','separation-request.lock'),async()=>{
  const path=join(dir,'state','separation-requests.json');let receipts:any={};try{receipts=await readJson(path);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const fingerprint=JSON.stringify({kind,...args}),prior=receipts[args.request_id];if(prior){if(prior.fingerprint!==fingerprint)throw Error('request_id reused with different separation settings');return {...prior.result,replayed:true};}
  const doc=await service.readDocument(args.project_id);if(!('kind'in doc)||doc.kind!=='separation')throw Error('Not a separation project');
  const job=await newJob(dir,{kind,...args},randomUUID()),status:any={id:job.id,project_id:args.project_id,kind,revision:args.base_revision??args.revision,state:'queued',owner_pid:process.pid,files:[],listening_status:'not_assessed'};
  await atomicJson(join(job.path,'status.json'),status);
  const result={job_id:job.id,state:'queued'};receipts[args.request_id]={fingerprint,result};await atomicJson(path,receipts);
  const controller=new AbortController();const done=service.processing.run(kind,async()=>{status.state='running';await atomicJson(join(job.path,'status.json'),status);await work(job,status,controller.signal);status.state='succeeded';await atomicJson(join(job.path,'status.json'),status);},{id:job.id,signal:controller.signal}).catch(async e=>{status.state=status.committed?'succeeded':controller.signal.aborted?'cancelled':'failed';if(!status.committed)status.error=String(e);await atomicJson(join(job.path,'status.json'),status);});
  service.trackBackground(job.id,controller,done);return result;
 });
}
export async function startSeparation(service:Service,args:z.infer<typeof separationRequest>){
 return launch(service,args,'separation',async(job,status,signal)=>{
  const before=await service.readDocument(args.project_id);if(before.revision!==args.base_revision)throw Error('Revision conflict before separation');
  const source=(await manifest(service.dir(args.project_id))).assets.find(a=>a.id===args.source_asset_id);if(!source||source.role!=='source')throw Error('Separation requires a source asset, not reference or derived audio');
  const path=await verifyAsset(service.dir(args.project_id),source),info=await audioInfo(service,path),frames=Math.round(info.duration_seconds*48000);
  const input=join(job.path,'work','input.wav');await ffmpeg(['-i',path,'-map','0:a:0','-ac','2','-ar','44100','-c:a','pcm_f32le',input],signal);
  const stems=await service.separator.separate({path:input,outputDirectory:join(job.path,'work','separated'),signal});
  if(stems.length<2||stems.length>32||new Set(stems.map(s=>s.name)).size!==stems.length||stems.some(s=>!id.safeParse(s.name).success))throw Error('Invalid separator stem names/count');
  const operations:any[]=[];if('composition'in before)for(const t of before.composition.tracks)operations.push({op:'remove_track',track_id:t.id});
  operations.push({op:'set_duration_frames',duration_frames:String(frames)},{op:'set_master_effects',effects:[]},{op:'set_buses',buses:[]});
  const output=join(job.path,'artifacts');await mkdir(output,{recursive:true});
  for(const stem of stems){
   if(signal.aborted)throw Error('Separation cancelled');
   const raw=await audioInfo(service,stem.path);if(Math.abs(raw.duration_seconds-info.duration_seconds)>0.01)throw Error('Separated stem duration mismatch');
   const dest=join(output,`${stem.name}.wav`);await ffmpeg(['-i',stem.path,'-ac','2','-ar','48000','-af',`aresample=48000,apad=whole_len=${frames},atrim=end_sample=${frames}`,'-c:a','pcm_f32le',dest],signal);
   const checked=await audioInfo(service,dest);if(checked.sample_rate!==48000||checked.channels!==2||Math.round(checked.duration_seconds*48000)!==frames)throw Error('Stem format mismatch');
   const asset=await ingest(service,args.project_id,dest,'derived',[source.id]);
   operations.push({op:'add_track',track:{id:stem.name,name:stem.name,instrument:{kind:'audio',asset_id:asset.id,start_frame:'0',end_frame:String(frames),timeline_frame:'0'},gain_db:0,pan:0,notes:[],effects:[]}});
   status.files.push({format:'wav',stem:stem.name,path:dest,sha256:asset.sha256});
  }
  operations.push({op:'set_separation',state:{source_asset_id:source.id,engine:service.separator.id,model:service.separator.model,job_id:job.id}});
  if(signal.aborted)throw Error('Separation cancelled');
  const changed=await service.apply({project_id:args.project_id,base_revision:args.base_revision,request_id:`sep-${job.id}`,operations,summary:'Separate source audio into stems'});
  status.committed=true;status.revision=changed.revision;status.engine=service.separator.id;status.model=service.separator.model;status.source_asset_id=source.id;
 });
}
export function audibleStems(tracks:Array<{mute?:boolean;solo?:boolean}>){const solo=tracks.some(t=>t.solo);return tracks.filter(t=>!t.mute&&(!solo||t.solo));}
export async function exportSeparation(service:Service,args:z.infer<typeof separationExportRequest>){
 return launch(service,args,'separation_export',async(job,status,signal)=>{
  const doc=await service.workspace.readRevision(args.project_id,args.revision);if(!('kind'in doc)||doc.kind!=='separation'||!doc.composition.tracks.length)throw Error('No separated stems');
  const all=doc.composition.tracks,chosen=args.kind==='stems'?all:audibleStems(all) as typeof all;if(!chosen.length)throw Error('No audible stems: clear mute or choose a solo stem');
  const assets=await manifest(service.dir(args.project_id)),tracks=[];
  for(const t of chosen){if(t.instrument.kind!=='audio')throw Error('Not an audio stem');const assetId=t.instrument.asset_id;const a=assets.assets.find(a=>a.id===assetId);if(!a)throw Error('Missing stem asset');tracks.push({track:t,path:await verifyAsset(service.dir(args.project_id),a),sha256:a.sha256});}
  const out=join(job.path,'artifacts');await mkdir(out,{recursive:true});
  const report:any={project_id:args.project_id,revision:args.revision,source:doc.separation,kind:args.kind,stems:tracks.map(({track,sha256})=>({id:track.id,gain_db:track.gain_db,mute:track.mute,solo:track.solo,sha256})),attenuation_db:0,listening_status:'not_assessed'};
  let output:string;
  if(args.kind==='stems'){
   output=join(out,'stems.zip');await writeZip(output,[...tracks.map(({track,path})=>({name:`${track.id}.wav`,path})),{name:'manifest.json',bytes:Buffer.from(JSON.stringify(report,null,2))}]);
  }else{
   const mix=join(job.path,'work','mix.wav');const filters=tracks.map(({track},i)=>`[${i}:a]volume=${track.gain_db}dB[a${i}]`);filters.push(`${tracks.map((_,i)=>`[a${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0:duration=longest[mix]`);
   await ffmpeg([...tracks.flatMap(t=>['-i',t.path]),'-filter_complex',filters.join(';'),'-map','[mix]','-ar','48000','-ac','2','-c:a','pcm_f32le',mix],signal);
   const info=await audioInfo(service,mix),gain=Math.min(1,0.98/Math.max(0.98,info.sample_peak));report.attenuation_db=20*Math.log10(gain);
   output=join(out,`mix.${args.format}`);await ffmpeg(['-i',mix,'-af',`volume=${gain}`, ...(args.format==='wav'?['-c:a','pcm_s24le']:args.format==='mp3'?['-c:a','libmp3lame','-b:a','320k']:['-c:a','flac','-sample_fmt','s32']),output],signal);
  }
  if(signal.aborted)throw Error('Export cancelled');await atomicJson(join(out,'manifest.json'),report);status.files=[{format:args.kind==='stems'?'zip':args.format,path:output,sha256:await sha256(output)}];status.output=output;status.report=report;
 });
}
