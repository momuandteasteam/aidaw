import {audioPlan} from '../Contracts/engine-contracts.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { id } from '../Domain/schema.js';
import { newJob, revisionSnapshot } from '../Adapters/node/workspace/layout.js';
import { atomicJson, locked, readJson } from '../Adapters/node/workspace/storage.js';
import { sha256 } from '../Adapters/node/workspace/assets.js';
import { renderMixer } from './mixer.js';
import type { Service } from './service.js';
const run=promisify(execFile);
export const exportRequest=z.object({project_id:id,request_id:id,scope:z.enum(['project','song','album']).default('project'),song_id:id.optional(),version_id:id.optional(),revision:z.number().int().nonnegative().optional(),formats:z.array(z.enum(['wav','mp3','flac'])).min(1).max(3),tail_seconds:z.number().min(0).max(30).optional()}).strict();
type Request=z.infer<typeof exportRequest>;
export async function startExport(service:Service,args:Request){
 const dir=service.dir(args.project_id);
 return locked(join(dir,'temp','export-request.lock'),async()=>{
  const receiptPath=join(dir,'state','export-requests.json');let receipts:any={};try{receipts=await readJson(receiptPath);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const fingerprint=JSON.stringify(args);const prior=receipts[args.request_id];if(prior){if(prior.fingerprint!==fingerprint)throw new Error('request_id reused with different export settings');return {...prior.result,replayed:true};}
  const current=await service.readDocument(args.project_id);
  const revision=args.revision??current.revision;
  const doc:any=revision===current.revision?current:await revisionSnapshot(dir,revision);
  const items:Array<{song_id?:string;version_id?:string;name:string;tail_seconds:number}>=[];
  if(doc.kind==='mastering'){
   if(args.scope==='project')throw new Error('Choose song or album for mastering export');
   if(args.scope==='song'&&!args.song_id)throw new Error('Song export requires song_id');
   if(args.scope==='album'&&args.version_id)throw new Error('Album export uses each song accepted or current version');
   const ids=args.scope==='song'?[args.song_id!]:doc.mastering.song_order;
   for(const songId of ids){const song=doc.mastering.songs.find((s:any)=>s.id===songId);if(!song)throw new Error('Unknown song');
    const versionId=args.version_id??song.accepted_version_id??song.current_version_id;const version=song.versions.find((v:any)=>v.id===versionId);if(!version)throw new Error('Unknown mastering version');
    items.push({song_id:songId,version_id:versionId,name:song.name,tail_seconds:args.tail_seconds??version.tail_seconds});
   }
  }else{
   if(args.scope!=='project'||args.song_id||args.version_id)throw new Error('Composition export requires project scope');
   items.push({name:doc.name,tail_seconds:args.tail_seconds??1});
  }
  if(!items.length)throw new Error('There are no songs to export');
  const formats=[...new Set(args.formats)];const job=await newJob(dir,{kind:'export',project_id:args.project_id,revision,items,formats},randomUUID());
  const status:any={id:job.id,project_id:args.project_id,revision,kind:'export',scope:args.scope,state:'queued',owner_pid:process.pid,completed:0,total:items.length,files:[],items:items.map(i=>({...i,state:'pending'})),listening_status:'not_assessed'};
  await atomicJson(join(job.path,'status.json'),status);
  const controller=new AbortController();
  const done=service.processing.run('export',async()=>{
   status.state='running';await atomicJson(join(job.path,'status.json'),status);
   for(const [index,item]of items.entries()){
    if(controller.signal.aborted)throw new Error('Export cancelled');
    const itemDir=join(job.path,'artifacts',item.song_id??'composition');await mkdir(join(itemDir,'artifacts'),{recursive:true});
    status.items[index].state='running';await atomicJson(join(job.path,'status.json'),status);
    const graph=await service.compileGraph(args.project_id,{revision,song_id:item.song_id,version_id:item.version_id});
    if(!graph.tracks.length)throw new Error('Project has no playable tracks');
    let resolved=await service.resolvedProject(graph);
    const options={timeout:900000,signal:controller.signal,workDir:join(job.path,'work')};
    // Composition retains the complete stem/mixer pipeline; mastering is one stereo path.
    if(doc.kind!=='mastering'){
     const mixed=await renderMixer(service,resolved,itemDir,item.tail_seconds,options);resolved=mixed.renderProject;
     status.items[index].stems=mixed.stems;status.items[index].premaster=mixed.premaster;status.items[index].instrument_prints=mixed.instrument_prints;
    }
    const audio=join(itemDir,'master.wav');
    const rendered=await service.engine.render({plan:audioPlan(resolved),output:audio,tail_seconds:item.tail_seconds},options);
    const stem=item.song_id??'master';
    for(const format of formats){
     const output=join(itemDir,`${stem}.${format}`);
     if(format==='wav') { if(output!==audio)await copyFile(audio,output); }
     else await run(process.env.AIDAW_FFMPEG??'ffmpeg',['-v','error','-y','-i',audio,'-map','0:a:0','-c:a',format==='mp3'?'libmp3lame':'flac',...(format==='mp3'?['-b:a','320k','-id3v2_version','3']:['-sample_fmt','s32']),'-metadata',`title=${item.name}`,'-metadata',`album=${doc.name}`,output],{signal:controller.signal,timeout:120000,maxBuffer:1048576});
     const probe=await run(process.env.AIDAW_FFPROBE??'ffprobe',['-v','error','-show_streams','-of','json',output],{signal:controller.signal,timeout:30000,maxBuffer:1048576});
     const streams=JSON.parse(probe.stdout).streams;const stream=streams.find((s:any)=>s.codec_type==='audio');
     if(!stream||Number(stream.sample_rate)!==48000||stream.channels!==2)throw new Error('Export audio verification failed');
     const expected={wav:'pcm_s24le',mp3:'mp3',flac:'flac'}[format];if(stream.codec_name!==expected)throw new Error('Export codec verification failed');
     status.files.push({song_id:item.song_id,version_id:item.version_id,format,path:output,sha256:await sha256(output)});
    }
    status.items[index].state='succeeded';status.items[index].analysis=rendered.analysis;status.completed=index+1;
    await atomicJson(join(job.path,'status.json'),status);
   }
   status.state='succeeded';status.output_directory=join(job.path,'artifacts');
   await atomicJson(join(job.path,'status.json'),status);
   // A job-specific manifest preserves earlier song and album releases.
   await atomicJson(join(dir,'outputs','reports',`export-${job.id}.json`),status);
  },{id:job.id,signal:controller.signal}).catch(async error=>{
   status.state=controller.signal.aborted?'cancelled':'failed';status.error=String(error);await atomicJson(join(job.path,'status.json'),status);
  });
  service.trackBackground(job.id,controller,done);
  const result={job_id:job.id,revision,state:status.state,items,formats};receipts[args.request_id]={fingerprint,result};await atomicJson(receiptPath,receipts);return result;
 });
}
