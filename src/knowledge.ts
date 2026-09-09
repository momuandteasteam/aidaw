import { binaryFingerprint } from './fingerprint.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, copyFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { sha256 } from './assets.js';
import { layout, newJob } from './layout.js';
import { atomicJson, readJson } from './storage.js';
import type { Service } from './service.js';
import { plugin, type Plugin } from './schema.js';

export const assessment = z.object({
 probe_id: z.string().uuid(), audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
 method: z.enum(['caller_audio_review','metadata_inference','human_audio_review']),
 reviewer: z.string().min(1).max(200), description: z.string().min(1).max(8000),
 tags: z.array(z.string().min(1).max(80)).max(40), uses: z.array(z.string().min(1).max(500)).max(20),
 confidence: z.number().min(0).max(1),
}).strict();
export class Knowledge {
 constructor(readonly service:Service) {}
 get dir(){return join(this.service.root,'PluginLibrary.aidaw');}
 async db(){
  await layout(this.dir); const db=new DatabaseSync(join(this.dir,'state','catalog.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, plugin_id TEXT, created TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS records_kind ON records(kind,plugin_id);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   INSERT OR IGNORE INTO meta VALUES('schema_version','1');`);return db;
 }
 async put(kind:string,data:any){const db=await this.db();try{const id=randomUUID();db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(id,kind,data.plugin_id??null,new Date().toISOString(),JSON.stringify({...data,id}));return {...data,id};}finally{db.close();}}
 async search(query:string,kind?:string,limit=20){const db=await this.db();try{return db.prepare("SELECT data FROM records WHERE (? IS NULL OR kind=?) AND instr(lower(data),lower(?))>0 ORDER BY created DESC LIMIT ?").all(kind??null,kind??null,query,limit).map((r:any)=>JSON.parse(r.data));}finally{db.close();}}
 async get(id:string){const db=await this.db();try{const r=db.prepare('SELECT data FROM records WHERE id=?').get(id) as any;if(!r)throw new Error('Unknown knowledge record');return JSON.parse(r.data);}finally{db.close();}}
 async index(s:Plugin){
  const job=await newJob(this.dir,{kind:'effect_index',plugin:s});
  try{const resolved=await this.service.resolvePlugin(s), info=await this.service.inspectPlugin(s);
   const record=await this.put('parameters',{plugin_id:s.plugin_id,version:resolved.plugin_version,platform:process.platform,arch:process.arch,parameters:info.parameters,programs:info.programs,buses:info.buses,program_count:info.program_count,meaning_status:'unmapped',evidence:'host_parameter_readback',job_id:job.id});
   await atomicJson(join(job.path,'status.json'),{state:'succeeded',record_id:record.id});return record;
  }catch(e){await atomicJson(join(job.path,'status.json'),{state:'failed',error:String(e)});throw e;}
 }
 async probe(s:Plugin,pitches:number[],velocity:number,bpm:number,sharedJob?:{id:string,path:string},force=false){
  const sourcePresetId=s.preset_id&&!s.state_base64&&s.program===undefined&&!s.parameters?.length&&!s.automation?.length?s.preset_id:undefined;
  const job=sharedJob??await newJob(this.dir,{kind:'sound_probe',plugin:s,pitches,velocity,bpm});const suffix=randomUUID();
  try{
   const resolved=await this.service.resolvePlugin(s);
   const saved=await this.service.engine.call({command:'inspect',plugin:resolved},{workDir:join(job.path,'work')});
   const concrete={...resolved,state_base64:saved.state_base64,parameters:[]};delete concrete.program;delete concrete.preset_id;
   const metadata=(await this.service.catalog()).plugins.find(p=>p.plugin_id===s.plugin_id);
   const binary=metadata?await binaryFingerprint(metadata.location).catch(()=>null):null;
   const engine=await sha256(this.service.engine.executable);
   const cacheKey=binary?createHash('sha256').update(JSON.stringify({source_preset_id:sourcePresetId,binary,engine,state:saved.state_base64,pitches,velocity,bpm,rate:48000,block:512,profile_version:1})).digest('hex'):undefined;
   if(cacheKey&&!force){for(const old of await this.search(cacheKey,'probe',10)){if(old.cache_key===cacheKey&&await sha256(old.path).catch(()=>null)===old.audio_sha256){if(!sharedJob)await atomicJson(join(job.path,'status.json'),{state:'succeeded',reused_record:old.id});return {...old,reused_frozen_take:true};}}}
   const stateHash=createHash('sha256').update(saved.state_base64).digest('hex');await atomicJson(join(this.dir,'state','plugins',`${stateHash}.json`),{plugin_id:s.plugin_id,version:resolved.plugin_version,state_base64:saved.state_base64});
   const notes=pitches.map((pitch,i)=>({id:`n${i}`,tick:i*1920,duration:960,pitch,velocity,channel:1}));
   const project={schema_version:1,id:'probe',name:'Preset audition',revision:0,sample_rate:48000,ppq:960,bpm,meter:[4,4],length_ticks:pitches.length*1920,tracks:[{id:'instrument',name:'Instrument',instrument:concrete,notes,effects:[],automation:[],gain_db:-12,pan:0}],master_effects:[],sections:[],harmony:[]};
   const output=join(job.path,'artifacts',`${suffix}-probe.wav`);
   const result=await this.service.engine.call({command:'render',project,output,tail_seconds:2},{timeout:120000,workDir:join(job.path,'work')});
   const hash=createHash('sha256').update(await readFile(output)).digest('hex');
   const cached=join(this.dir,'state','frozen',`${hash}.wav`);await copyFile(output,cached);
   const record=await this.put('probe',{source_preset_id:sourcePresetId,plugin_id:s.plugin_id,version:resolved.plugin_version,binary_sha256:binary,engine_sha256:engine,cache_key:cacheKey,platform:process.platform,arch:process.arch,state_sha256:createHash('sha256').update(saved.state_base64).digest('hex'),audio_sha256:hash,path:cached,mime_type:'audio/wav',profile:{pitches,velocity,bpm,gain_db:-12,tail_seconds:2},analysis:result.analysis,review_status:'audio_review_pending',job_id:job.id});
   await atomicJson(join(job.path,'snapshots',`${suffix}-input.json`),project);
   if(!sharedJob)await atomicJson(join(job.path,'status.json'),{state:'succeeded',record_id:record.id});
   return {...record,instruction:'Open this audio in the calling tool, then submit sound_assess. Numeric analysis alone is metadata_inference.'};
  }catch(e){if(!sharedJob)await atomicJson(join(job.path,'status.json'),{state:'failed',error:String(e)});throw e;}
 }
 async verify(s:Plugin){
  const job=await newJob(this.dir,{kind:'plugin_verify',plugin:s});
  let record:any;
  try{
   const resolved=await this.service.resolvePlugin(s),source=(await this.service.catalog()).plugins.find(p=>p.plugin_id===s.plugin_id)!;
   const original=await this.service.engine.call({command:'inspect',plugin:resolved},{workDir:join(job.path,'work')});
   const restored={...resolved,state_base64:original.state_base64,parameters:[]};delete restored.program;delete restored.preset_id;
   const readback=await this.service.engine.call({command:'inspect',plugin:restored},{workDir:join(job.path,'work')});
   const stable=original.parameters.every((p:any)=>readback.parameters.some((r:any)=>r.id===p.id&&Math.abs(r.value-p.value)<1e-5));
   let comparison:any,render_status='not_tested';
   if(source.instrument){const first=await this.probe(s,[48,60],100,120,job,true),second=await this.probe(restored,[48,60],100,120,job,true);comparison=await this.service.engine.call({command:'compare_audio',reference:first.path,paths:[second.path]},{workDir:join(job.path,'work')});render_status=first.analysis.silent?'rendered_silence':'rendered_audio';}
   record=await this.put('compatibility',{plugin_id:s.plugin_id,version:resolved.plugin_version,format:source.format,platform:process.platform,arch:process.arch,binary_sha256:await binaryFingerprint(source.location).catch(()=>null),engine_sha256:await sha256(this.service.engine.executable),load:'passed',state_roundtrip:stable?'parameter_readback_passed':'parameter_readback_differs',render_status,reproducibility:comparison?.exact_samples?'bit_exact_samples':comparison?'frozen_only':'unknown',comparison,automation:'not_tested',sidechain:'unsupported',job_id:job.id});
   await atomicJson(join(job.path,'status.json'),{state:'succeeded',record_id:record.id});
  }catch(e){record=await this.put('compatibility',{plugin_id:s.plugin_id,platform:process.platform,arch:process.arch,status:'failed',error:String(e),job_id:job.id});await atomicJson(join(job.path,'status.json'),{state:'failed',record_id:record.id,error:String(e)});}
  return record;
 }
 async annotate(pluginRecordId:string,parameterId:string,meaning:string,evidence:string){
  const record=await this.get(pluginRecordId);if(!record.parameters?.some((p:any)=>p.id===parameterId))throw new Error('Unknown parameter in snapshot');
  return this.put('parameter_annotation',{plugin_id:record.plugin_id,snapshot_id:pluginRecordId,parameter_id:parameterId,meaning,evidence,normalized_conversion:'not_inferred'});
 }
 async findSound(query:string,kind:'sound'|'effect',limit:number){
  const records=await this.search(query,undefined,100),catalog=await this.service.catalog();
  return records.filter(r=>{const p=catalog.plugins.find(p=>p.plugin_id===r.plugin_id);return p&&p.instrument===(kind==='sound');}).slice(0,limit).map(r=>({ ...r,availability:'registered_on_this_machine',compatibility:'verify_exact_version_before_relying_on_it'}));
 }
 async catalogIndex(){
  const c=await this.service.catalog();
  let added=0;for(const kind of ['plugins','presets'])for(const item of (c as any)[kind]){const key=createHash('sha256').update(JSON.stringify(item)).digest('hex');if((await this.search(key,'catalog',1)).length)continue;
   const {state_base64,description_xml,...metadata}=item;await this.put('catalog',{...metadata,source_kind:kind,fingerprint:key,compatibility:'unknown',state_available:!!state_base64});++added;}
  return {added,storage:join(this.dir,'state','catalog.sqlite')};
 }
 async batch(plugins:Plugin[],pitches:number[],velocity:number,bpm:number,maxSeconds:number,resumeId?:string){
  const job=resumeId?{id:resumeId,path:join(this.dir,'jobs',resumeId)}:await newJob(this.dir,{kind:'instrument_probe',plugins,pitches,velocity,bpm,max_seconds:maxSeconds});
  let status:any;if(resumeId){const request=await readJson(join(job.path,'request.json'));if(request.kind!=='instrument_probe')throw new Error('Not a probe batch');plugins=request.plugins;pitches=request.pitches;velocity=request.velocity;bpm=request.bpm;maxSeconds=request.max_seconds;status=await readJson(join(job.path,'status.json'));}
  else status={id:job.id,state:'running',tasks:plugins.map((plugin,i)=>({id:i,plugin,state:'pending'}))};
  const started=Date.now();status.state='running';await atomicJson(join(job.path,'status.json'),status);
  for(const task of status.tasks){if(task.state==='succeeded')continue;if(Date.now()-started>=maxSeconds*1000){status.state='paused';break;}
   task.state='running';task.attempt=(task.attempt??0)+1;await atomicJson(join(job.path,'status.json'),status);
   try{task.result=await this.probe(task.plugin,pitches,velocity,bpm,job);task.state='succeeded';delete task.error;}catch(e){task.state='failed';task.error=String(e);}
   await atomicJson(join(job.path,'status.json'),status);
  }
  if(status.state==='running')status.state=status.tasks.every((t:any)=>t.state==='succeeded')?'succeeded':'failed';await atomicJson(join(job.path,'status.json'),status);return status;
 }
 async effectProbe(s:Plugin,path:string){
  const job=await newJob(this.dir,{kind:'effect_probe',plugin:s,input:path});
  try{const before=join(job.path,'artifacts','before.wav');await copyFile(path,before);const analysis=await this.service.engine.call({command:'analyze',path:before});
   if(analysis.sample_rate!==48000||analysis.duration_seconds>30)throw new Error('Effect probe needs at most 30 seconds of 48 kHz audio');
   const resolved=await this.service.resolvePlugin(s),output=join(job.path,'artifacts','after.wav');
   const project={schema_version:2,id:'effect-probe',revision:0,sample_rate:48000,ppq:960,bpm:120,meter:[4,4],length_ticks:1,duration_frames:String(analysis.frames),tracks:[{id:'input',instrument:{kind:'builtin',sound:'sine'},audio_source_path:before,audio_clip:{start_frame:'0'},notes:[],automation:[],effects:[resolved],gain_db:0,pan:0,unity_gain:true}],master_effects:[]};
   const result=await this.service.engine.call({command:'render',project,output,tail_seconds:2,sample_format:'float32'},{timeout:120000,workDir:join(job.path,'work')});
   const hash=await sha256(output),cached=join(this.dir,'state','frozen',`${hash}.wav`);await layout(this.dir);await copyFile(output,cached);
   const inputHash=await sha256(before),inputCached=join(this.dir,'state','frozen',`${inputHash}.wav`);await copyFile(before,inputCached);
   const gainDb=analysis.rms>0&&result.analysis.rms>0?Math.max(-12,Math.min(12,20*Math.log10(analysis.rms/result.analysis.rms))):0;
   const matched=join(job.path,'artifacts','after-rms-matched.wav');
   await this.service.engine.call({command:'render',project:{...project,duration_frames:String(result.analysis.frames),tracks:[{...project.tracks[0],audio_source_path:output,effects:[]}],master_gain_db:gainDb},output:matched,tail_seconds:0,sample_format:'float32'},{timeout:120000,workDir:join(job.path,'work')});
   const matchedHash=await sha256(matched),matchedCached=join(this.dir,'state','frozen',`${matchedHash}.wav`);await copyFile(matched,matchedCached);
   const record=await this.put('effect_probe',{plugin_id:s.plugin_id,version:resolved.plugin_version,matched_path:matchedCached,matched_sha256:matchedHash,gain_matching:{method:'whole-render RMS including tail; approximate audition only',gain_db:gainDb,limit_db:12},input_path:inputCached,input_sha256:inputHash,path:cached,audio_sha256:hash,mime_type:'audio/wav',input_analysis:analysis,output_analysis:result.analysis,latency_compensation:result.latency_compensation,review_status:'audio_review_pending',job_id:job.id,parameters:s.parameters});
   await atomicJson(join(job.path,'status.json'),{state:'succeeded',record_id:record.id});return record;
  }catch(e){await atomicJson(join(job.path,'status.json'),{state:'failed',error:String(e)});throw e;}
 }
 async context(projectId:string,trackId:string,s:Plugin){
  const p=await this.service.read(projectId),track=p.tracks.find(t=>t.id===trackId);if(!track||track.instrument.kind==='audio')throw new Error('Context audition requires a MIDI track');
  const job=await newJob(this.dir,{kind:'sound_audition_in_context',project_id:projectId,revision:p.revision,track_id:trackId,plugin:s});
  try{const concrete=structuredClone(p);concrete.tracks=concrete.tracks.map(t=>t.id===trackId?{...t,instrument:s}:t);
   const resolved=await this.service.resolvedProject(concrete);const output=join(job.path,'artifacts','context.wav');
   const result=await this.service.engine.call({command:'render',project:resolved,output,tail_seconds:2,sample_format:'float32'},{timeout:120000,workDir:join(job.path,'work')});
   const hash=await sha256(output);await layout(this.dir);const cached=join(this.dir,'state','frozen',`${hash}.wav`);await copyFile(output,cached);
   const record=await this.put('probe',{plugin_id:s.plugin_id,path:cached,audio_sha256:hash,mime_type:'audio/wav',context:{project_id:projectId,revision:p.revision,track_id:trackId},analysis:result.analysis,review_status:'audio_review_pending',job_id:job.id});await atomicJson(join(job.path,'status.json'),{state:'succeeded',record_id:record.id});return record;
  }catch(e){await atomicJson(join(job.path,'status.json'),{state:'failed',error:String(e)});throw e;}
 }
 async feedback(recordId:string,reviewer:string,comment:string,preference:'prefer'|'avoid'|'neutral'){
  const target=await this.get(recordId);return this.put('feedback',{record_id:recordId,plugin_id:target.plugin_id,reviewer,comment,preference,scope:'this_record_only'});
 }
 async assess(input:unknown){
  const a=assessment.parse(input),probe=await this.get(a.probe_id);
  if(!probe.path||probe.audio_sha256!==a.audio_sha256)throw new Error('Assessment audio does not match the probe');
  const actual=createHash('sha256').update(await readFile(probe.path)).digest('hex');
  if(actual!==a.audio_sha256)throw new Error('Probe audio changed after rendering');
  return this.put('assessment',{...a,plugin_id:probe.plugin_id,evidence_scope:a.method==='caller_audio_review'?'Caller-reported audio review; listening not independently verified by server':a.method});
 }
}
export const knowledgeDefinitions={
 plugin_verify:{description:'Isolated load and state roundtrip test, with two actual renders for instruments. Records version/platform/binary and distinct untested capabilities.',schema:z.object({plugin}).strict()},
 parameter_annotate:{description:'Attach evidenced meaning to a known parameter snapshot; never infer a linear normalized-to-unit mapping.',schema:z.object({snapshot_id:z.string().uuid(),parameter_id:z.string().min(1),meaning:z.string().min(1).max(2000),evidence:z.string().min(1).max(2000)}).strict()},
 sound_search:{description:'Find sound records with caller assessments and currently registered instrument availability.',schema:z.object({query:z.string().max(500).default(''),limit:z.number().int().min(1).max(30).default(10)}).strict()},
 effect_search:{description:'Find effect records with parameter/effect evidence and current registration.',schema:z.object({query:z.string().max(500).default(''),limit:z.number().int().min(1).max(30).default(10)}).strict()},

 catalog_index:{description:'Incrementally record local plugin/preset metadata without declaring render compatibility.',schema:z.object({}).strict()},
 instrument_probe:{description:'Probe a bounded preset batch in one job; retry/resume preserves completed tasks.',schema:z.object({plugins:z.array(plugin).min(1).max(100),pitches:z.array(z.number().int().min(0).max(127)).min(1).max(12).default([36,48,60,72]),velocity:z.number().int().min(1).max(127).default(100),bpm:z.number().min(40).max(240).default(120),max_seconds:z.number().int().min(1).max(600).default(60)}).strict()},
 instrument_probe_resume:{description:'Resume failed/pending tasks in an existing probe batch.',schema:z.object({job_id:z.string().uuid()}).strict()},
 effect_probe:{description:'Render an effect on a short input and return before/after audio for the caller to assess.',schema:z.object({plugin,path:z.string().min(1)}).strict()},
 sound_audition_in_context:{description:'Audition a preset on an existing MIDI part in context without changing the project.',schema:z.object({project_id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),track_id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),plugin}).strict()},
 catalog_feedback:{description:'Store user preference for one exact probe/assessment, not a global plugin prohibition.',schema:z.object({record_id:z.string().uuid(),reviewer:z.string().min(1).max(200),comment:z.string().min(1).max(4000),preference:z.enum(['prefer','avoid','neutral'])}).strict()},

 effect_index:{description:'Read and store plugin parameters and programs. Parameter semantics remain unmapped until supported by evidence.',schema:z.object({plugin}).strict()},
 sound_probe:{description:'Render a short preset audition and return a local audio path and hash for the calling AI to review. No model/provider configuration.',schema:z.object({plugin,pitches:z.array(z.number().int().min(0).max(127)).min(1).max(12).default([36,48,60,72]),velocity:z.number().int().min(1).max(127).default(100),bpm:z.number().min(40).max(240).default(120)}).strict()},
 sound_assess:{description:'Append caller or human assessment tied to exact probe audio. Use metadata_inference if the audio was not listened to.',schema:assessment},
 knowledge_search:{description:'Search stored parameters, probes, and assessments. Search results retain evidence type; unreviewed probes are not AI listening results.',schema:z.object({query:z.string().max(500).default(''),kind:z.enum(['parameters','probe','assessment','catalog','effect_probe','feedback','compatibility','parameter_annotation']).optional(),limit:z.number().int().min(1).max(100).default(20)}).strict()},
};
