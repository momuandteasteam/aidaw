import {comparisonIdentity} from '../../../Application/mastering-preview.js';
import { z } from 'zod';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, opendir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { id } from '../../../Domain/schema.js';
import { parseDocument, resolveMasteringTarget } from '../../../Domain/domain.js';
import { revisionSnapshot } from '../workspace/layout.js';
import { contained, manifest, sha256 } from '../workspace/assets.js';
import { readJson } from '../workspace/storage.js';
import type { Service } from '../../../Application/service.js';
const run = promisify(execFile);
const rate = 48000, maxSeconds = 1830, maxBytes = 2 * 1024 ** 3;
export const waveformInput = z.object({project_id:id, revision:z.number().int().nonnegative().optional(), song_id:id.optional(), version_id:id.optional(), comparison:z.enum(['a','b']).optional(), bins:z.number().int().min(64).max(1000).default(400)}).strict();
type Request = z.infer<typeof waveformInput>;
type Audio = {path:string; hash:string; start?:number; span?:number; offset?:number; duration?:number};
// Bounded, process-local derived cache; keys include immutable identity and file metadata.
const cache = new Map<string, Promise<{peaks:number[];duration:number}>>();
async function optionalJson(path:string) {try{return await readJson(path);}catch(e:any){if(e.code==='ENOENT')return null;throw e;}}
async function existingMix(dir:string, revision:number):Promise<Audio|null> {
 const frozen=await optionalJson(join(dir,'state','frozen.json'));
 if(frozen?.revision===revision&&typeof frozen.master==='string') {
  const hash=basename(frozen.master,'.wav');
  if(/^[a-f0-9]{64}$/.test(hash))try{return {path:await contained(dir,frozen.master),hash};}catch(e:any){if(e.code!=='ENOENT')throw e;}
 }
 // Historical renders remain eligible even when a newer frozen mix replaced the current pointer.
 let scanned=0;
 try {for await(const entry of await opendir(join(dir,'jobs'))) {
  if(++scanned>1000)break;
  if(!entry.isDirectory()||!id.safeParse(entry.name).success)continue;
  const job=await optionalJson(join(dir,'jobs',entry.name,'status.json'));
  if(job?.state!=='succeeded'||job.revision!==revision)continue;
  const file=job.kind==='export'&&job.scope==='project'?(job.files?.find((f:any)=>f.format==='wav')??job.files?.find((f:any)=>['flac','mp3'].includes(f.format))):job.scope==='project'&&!job.track_id?{path:job.output,sha256:job.sha256}:null;
  if(!file?.path||!/^[a-f0-9]{64}$/.test(file.sha256??''))continue;
  try{return {path:await contained(dir,relative(dir,file.path).split('\\').join('/')),hash:file.sha256};}catch(e:any){if(e.code!=='ENOENT')throw e;}
 }}catch(e:any){if(e.code!=='ENOENT')throw e;}
 return null;
}
async function decode(audio:Audio,bins:number) {
 if(await sha256(audio.path)!==audio.hash)throw Error('Waveform audio hash mismatch');
 const probe=await run(process.env.AIDAW_FFPROBE??'ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration,sample_rate:format=duration','-of','json',audio.path],{timeout:10000,maxBuffer:65536});
 const info=JSON.parse(probe.stdout),seconds=Number(info.streams?.[0]?.duration??info.format?.duration);
 if(!Number.isFinite(seconds)||seconds<=0||seconds>maxSeconds)throw Error('Waveform audio duration outside supported range');
 const sourceFrames=Math.round(seconds*rate),start=audio.start??0,span=audio.span??sourceFrames-start,offset=audio.offset??0,duration=audio.duration??span;
 if(start<0||span<=0||start+span>sourceFrames+2||duration<=0||duration>maxSeconds*rate||offset+span>duration)throw Error('Waveform clip range is invalid');
 const peaks=Array(bins).fill(0);
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(process.env.AIDAW_FFMPEG??'ffmpeg',['-v','error','-nostdin','-ss',String(start/rate),'-i',audio.path,'-t',String(span/rate),'-map','0:a:0','-ac','2','-ar',String(rate),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','pipe']});
  let remainder=Buffer.alloc(0),frames=0,errorText='',failure:Error|undefined;
  const fail=(message:string)=>{failure=new Error(message);child.kill('SIGKILL');};
  const timer=setTimeout(()=>fail('Waveform decode timed out'),30000);
  child.stdout.on('data',(chunk:Buffer)=>{
   const data=remainder.length?Buffer.concat([remainder,chunk]):chunk;
   const end=data.length-data.length%8;
   for(let pos=0;pos<end;pos+=8){
    if(frames>=span+2){fail('Waveform decode exceeded its frame limit');break;}
    const index=Math.floor((offset+frames)*bins/duration);
    const value=Math.max(Math.abs(data.readFloatLE(pos)),Math.abs(data.readFloatLE(pos+4)));
    if(index<bins&&Number.isFinite(value))peaks[index]=Math.max(peaks[index],Math.min(1,value));
    frames++;
   }
   remainder=Buffer.from(data.subarray(end));
  });
  child.stderr.on('data',(chunk:Buffer)=>{if(errorText.length<4096)errorText+=chunk.toString().slice(0,4096-errorText.length);});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0)reject(Error(`Waveform decode failed: ${errorText}`));else if(!frames)reject(Error('Waveform audio contains no samples'));else resolve();});
 });
 return {peaks,duration};
}
export async function projectWaveform(service:Service, input:Request) {
 const args=waveformInput.parse(input),dir=service.dir(args.project_id),current=await service.readDocument(args.project_id);
 const revision=args.revision??current.revision,doc=revision===current.revision?current:parseDocument(await revisionSnapshot(dir,revision));
 const kind=doc.schema_version===3?doc.kind:'composition';
 let audio:Audio|null,role:'source'|'processed_mix',song_id:string|undefined,version_id:string|undefined;
 if(doc.schema_version===3&&doc.kind==='separation'){
  const assets=(await manifest(dir)).assets,layers=[];
  for(const track of doc.composition.tracks){
   if(track.instrument.kind!=='audio')continue;
   const assetId=track.instrument.asset_id,asset=assets.find(a=>a.id===assetId);
   if(!asset||!['source','derived'].includes(asset.role))continue;
   const audio={path:await contained(dir,asset.path),hash:asset.sha256,duration:Number(doc.composition.duration_frames)};
   const measured=await measure(audio,args.bins);layers.push({track_id:track.id,peaks:measured.peaks});
  }
  return {available:layers.length>0,project_id:args.project_id,revision,kind,role:'stems',sample_rate:rate,duration_frames:doc.composition.duration_frames,layers};
 }
 if(doc.schema_version===3&&doc.kind==='mastering') {
  const target=resolveMasteringTarget(doc,args),v=target.version;
  const asset=(await manifest(dir)).assets.find(a=>a.id===v.source_asset_id);
  if(!asset||asset.role==='reference'||asset.role==='artwork')throw Error('Mastering waveform source is unavailable');
  if(asset.sha256!==v.source_sha256)throw Error('Mastering waveform source identity mismatch');
  const path=await contained(dir,asset.path);
  const start=Number(v.clip.start_frame),end=v.clip.end_frame===undefined?Number(asset.audio?.frames):Number(v.clip.end_frame);
  audio={path,hash:asset.sha256,start,span:end-start,offset:Number(v.clip.timeline_frame),duration:Number(v.duration_frames)};
  role='source';song_id=target.song.id;version_id=v.id;
  const prepared=service.comparisonAudio.get(comparisonIdentity({...doc,id:args.project_id},args));if(prepared){audio={...prepared};role='processed_mix';}
 }else{
  if(args.song_id||args.version_id||args.comparison)throw Error('Composition waveform cannot select a mastering song');
  audio=await existingMix(dir,revision);role='processed_mix';
 }
 if(!audio)return {available:false,project_id:args.project_id,revision,kind,reason:'audio_not_generated'};
 const decoded=await measure(audio,args.bins);
 return {available:true,project_id:args.project_id,revision,kind,role,sample_rate:rate,duration_frames:String(decoded.duration),peaks:decoded.peaks,song_id,version_id,audio_sha256:audio.hash};
}

async function measure(audio:Audio,bins:number){
 const before=await stat(audio.path);
 if(!before.isFile()||before.size>maxBytes)throw Error('Waveform audio exceeds the 2 GiB file limit');
 const key=JSON.stringify({...audio,bins:bins,size:before.size,mtime:before.mtimeMs,ctime:before.ctimeMs});
 let result=cache.get(key);
 if(!result){
  result=decode(audio,bins).then(async decoded=>{const after=await stat(audio!.path);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Audio changed during waveform measurement');return decoded;});
  cache.set(key,result);if(cache.size>32)cache.delete(cache.keys().next().value!);
  result.catch(()=>cache.delete(key));
 }
 return await result;
}
