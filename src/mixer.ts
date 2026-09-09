import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, locked, readJson } from './storage.js';
import { sha256, contained } from './assets.js';
import { binaryFingerprint } from './fingerprint.js';
import type { Service } from './service.js';

// Each node consumes frozen upstream audio. Cache identity contains sound-producing
// inputs only; names, revision IDs, and unrelated mixer channels do not invalidate it.
export async function renderMixer(service:Service,p:any,dir:string,tail:number,options:any){
 const projectDir=service.dir(p.id),cacheFile=join(projectDir,'state','render-cache.json');
 const traces:any[]=[],catalog=await service.catalog(),binary:Record<string,string>={};
 const allPlugins=[...p.tracks.flatMap((t:any)=>[...(t.instrument.kind==='plugin'?[t.instrument]:[]),...t.effects]),...p.buses.flatMap((b:any)=>b.effects)];
 for(const plugin of allPlugins){if(binary[plugin.plugin_id])continue;const meta=catalog.plugins.find(x=>x.plugin_id===plugin.plugin_id);binary[plugin.plugin_id]=meta?await binaryFingerprint(meta.location).catch(()=>`unverified-${dir}`):`missing-${dir}`;}
 const cleanPlugin=(plugin:any)=>{const{description_xml,...state}=plugin;return {...state,binary:binary[plugin.plugin_id]};};
 const time={rate:p.sample_rate,bpm:p.bpm,ppq:p.ppq,meter:p.meter,length_ticks:p.length_ticks,duration_frames:p.duration_frames,tail,engine:await sha256(service.engine.executable),mixer_version:1};
 async function stage(name:string,identity:any,tracks:any[],effects:any[]=[],gain=0,force=false){
  if(options.signal?.aborted)throw new Error('Job cancelled');
  const key=createHash('sha256').update(JSON.stringify({time,identity})).digest('hex'),output=join(dir,'artifacts',`${name}.wav`);
  let cache:any={};try{cache=await readJson(cacheFile);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const saved=cache[key];
  const cachedPath=saved?await contained(projectDir,saved.path).catch(()=>undefined):undefined;
  if(!force&&saved&&cachedPath&&await sha256(cachedPath).catch(()=>null)===saved.sha256){await copyFile(cachedPath,output);traces.push({node:name,key,reused:true});return {...saved.result,output,sha256:saved.sha256};}
  const result=await service.engine.call({command:'render',project:{...p,tracks,buses:[],master_effects:effects,master_gain_db:gain},output,tail_seconds:tail,sample_format:'float32'},options);
  const hash=await sha256(output),path=`state/frozen/${hash}.wav`;await copyFile(output,join(projectDir,path));
  await locked(join(projectDir,'temp','render-cache.lock'),async()=>{let current:any={};try{current=await readJson(cacheFile);}catch(e:any){if(e.code!=='ENOENT')throw e;}current[key]={path,sha256:hash,result};await atomicJson(cacheFile,current);});
  traces.push({node:name,key,reused:false});return {...result,sha256:hash};
 }
 const empty={id:'input',instrument:{kind:'builtin',sound:'sine'},notes:[],automation:[],effects:[],gain_db:0,pan:0};
 const source=(path:string,extra:any={})=>({...empty,audio_source_path:path,audio_clip:{start_frame:'0',timeline_frame:'0'},...extra});
 const cached=(id:string,path:string,gain=0)=>({...empty,id,rendered_audio_path:path,cached_gain_db:gain});
 const stems:Record<string,any>={},prints:Record<string,string>={},inserts:Record<string,string>={},channels:Record<string,any>={};
 const soloTracks=p.tracks.some((t:any)=>t.solo),soloBuses=p.buses.some((b:any)=>b.solo);
 for(const t of p.tracks){
  const audioHash=t.audio_source_path?await sha256(t.audio_source_path):undefined;
  const instrument=t.instrument.kind==='plugin'?cleanPlugin(t.instrument):t.instrument;
  const take=await stage(`instrument-${t.id}`,{stage:'instrument',track_id:t.id,instrument,notes:t.notes,automation:t.automation,clip:t.audio_clip,audioHash},[{...t,effects:[],unity_gain:true}],[],0,options.rerender_tracks?.includes(t.id)??false);prints[t.id]=take.output;
  const insert=await stage(`insert-${t.id}`,{stage:'insert',track_id:t.id,input:take.sha256,effects:t.effects.map(cleanPlugin)},[source(take.output,{effects:t.effects,unity_gain:true})]);inserts[t.id]=insert.output;
  const fader=await stage(`fader-${t.id}`,{stage:'fader',input:insert.sha256,gain:t.gain_db,pan:t.pan,audio_balance:t.instrument.kind==='audio'},[source(insert.output,{instrument:t.instrument,gain_db:t.gain_db,pan:t.pan})]);
  const audible=!t.mute&&(!soloTracks||t.solo);
  channels[t.id]={take,insert,fader,audible};
  const main=await stage(`stem-${t.id}`,{stage:'track_main',input:fader.sha256,enabled:audible&&t.to_master&&!soloBuses},audible&&t.to_master&&!soloBuses?[cached(t.id,fader.output)]:[]);
  stems[t.id]={...main,role:'track',latency_compensation:{...insert.latency_compensation,instrument_samples:take.latency_compensation.trimmed_samples,trimmed_samples:take.latency_compensation.trimmed_samples+insert.latency_compensation.trimmed_samples},automation:take.automation};
 }
 for(const bus of p.buses){
  const incoming=p.tracks.flatMap((t:any)=>t.sends.filter((s:any)=>s.bus_id===bus.id&&s.enabled&&channels[t.id].audible).map((s:any)=>{const upstream=s.position==='pre_fader'?channels[t.id].insert:channels[t.id].fader;return {id:t.id,path:upstream.output,hash:upstream.sha256,gain:s.gain_db,position:s.position};}));
  const sum=await stage(`send-${bus.id}`,{stage:'send_sum',inputs:incoming.map(({path,...s}:any)=>s)},incoming.map((s:any)=>cached(s.id,s.path,s.gain)));
  const processed=await stage(`return-insert-${bus.id}`,{stage:'return_insert',bus_id:bus.id,input:sum.sha256,effects:bus.effects.map(cleanPlugin)},[cached(bus.id,sum.output)],bus.effects);
  const enabled=!bus.mute&&(!soloBuses||bus.solo);
  const out=await stage(`stem-${bus.id}`,{stage:'return_fader',input:processed.sha256,gain:bus.gain_db,pan:bus.pan,enabled},enabled?[source(processed.output,{instrument:{kind:'audio'},gain_db:bus.gain_db,pan:bus.pan})]:[]);
  stems[bus.id]={...out,role:'fx_return',latency_compensation:processed.latency_compensation};
 }
 const mixedTracks=Object.entries(stems).map(([id,s])=>cached(id,s.output));
 const premaster=await stage('premaster',{stage:'premaster',inputs:Object.entries(stems).map(([id,s])=>({id,hash:s.sha256}))},mixedTracks);
 const check=await service.engine.call({command:'compare_audio',reference:premaster.output,paths:Object.values(stems).map(s=>s.output)},options);
 if(check.max_absolute_difference>1e-6)throw new Error('Stems do not reconstruct premaster');
 const mixer={schema_version:1,revision:p.revision,tracks:p.tracks.map((t:any)=>({id:t.id,name:t.name,gain_db:t.gain_db,pan:t.pan,mute:t.mute,solo:t.solo,to_master:t.to_master,sends:t.sends,meter:stems[t.id].analysis})),returns:p.buses.map((b:any)=>({id:b.id,name:b.name,gain_db:b.gain_db,pan:b.pan,mute:b.mute,solo:b.solo,meter:stems[b.id].analysis,effects:b.effects.map((fx:any)=>({plugin_id:fx.plugin_id,plugin_version:fx.plugin_version}))})),stem_semantics:'track main contributions plus FX returns sum to premaster; no master FX in stems',return_wetness:'Plugin dry/wet must be configured explicitly; no guessed parameter changes',stages:traces};
 await atomicJson(join(dir,'artifacts','mixer.json'),mixer);
 await atomicJson(join(dir,'report.json'),{stem_sum:check,render_graph:traces,listening_status:'not_assessed'});
 return {stems,instrument_prints:prints,insert_prints:inserts,premaster:premaster.output,render_graph:traces,mixer,renderProject:{...p,tracks:mixedTracks}};
}
