import {getWorkingMix} from '../Adapters/node/workspace/working-mix.js';
import {createHash} from 'node:crypto';
import {mkdir,rename,rm,readdir,stat,copyFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {audioPlan} from '../Contracts/engine-contracts.js';
import {compileDocument,resolveMasteringTarget} from '../Domain/domain.js';
import {atomicJson,readJson} from '../Adapters/node/workspace/storage.js';
import {sha256} from '../Adapters/node/workspace/assets.js';
import type {Service} from './service.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const comparisonIdentity=(doc:any,args:any)=>{const t=resolveMasteringTarget(doc,args),{label,created_at,...version}=t.version as any;return hash([doc.id,t.song.id,t.selection,version]);};
export const comparisonCacheKey=(engine:string,plan:any,tail:number,sourceHash:string)=>{
 const {provenance,...dsp}=plan;
 return hash([engine,{...dsp,channels:dsp.channels.map(({name,...channel}:any)=>channel),returns:dsp.returns.map(({name,...bus}:any)=>bus)},tail,sourceHash]);
};
export async function prepareComparison(service:Service,doc:any,args:any,signal:AbortSignal){
 if((await getWorkingMix(service,doc.id)).entries.length)return undefined;
 const targets=['a','b'].map(comparison=>resolveMasteringTarget(doc,{...args,comparison,version_id:undefined}));
 const bytes=targets.reduce((n,t)=>n+(Number(t.version.duration_frames)+(t.selection.kind==='source'?0:t.version.tail_seconds*48000))*8,0);
 if(bytes>256*1024*1024)return undefined;
 const engine=await service.engine.describe();if(!engine.features.includes('playback.prepared_comparison.v1'))return undefined;
 const dir=join(service.dir(doc.id),'temp','mastering-preview');await mkdir(dir,{recursive:true});const paths:string[]=[],identities:string[]=[],keep=new Set<string>();
 for(const slot of ['a','b'] as const){
  if(signal.aborted)throw Error('Comparison preparation cancelled');
  const targetArgs={...args,comparison:slot,version_id:undefined},existing=await completedVersionAudio(service,doc,targetArgs);
  if(existing){const identity=comparisonIdentity(doc,targetArgs);paths.push(existing.path);identities.push(identity);keep.add(basename(existing.path,'.wav'));continue;}
  const target=resolveMasteringTarget(doc,targetArgs);
  const plan=audioPlan(await service.resolvedProject(compileDocument(doc,{...args,comparison:slot,version_id:undefined}))),tail=target.selection.kind==='source'?0:target.version.tail_seconds;
  const key=comparisonCacheKey(engine.content_fingerprint,plan,tail,target.version.source_sha256),output=join(dir,key+'.wav'),receipt=join(dir,key+'.json');keep.add(key);
  let saved:any;try{saved=await readJson(receipt);if(saved.hash!==await sha256(output))saved=null;}catch(e:any){if(e.code!=='ENOENT')throw e;}
  // An exact old-format plan key is safe to migrate after checking its output hash.
  if(!saved){const legacy=hash([engine.content_fingerprint,plan,tail]);try{const record=await readJson(join(dir,legacy+'.json'));if(record.hash===await sha256(join(dir,legacy+'.wav'))){await copyFile(join(dir,legacy+'.wav'),output);saved=record;await atomicJson(receipt,saved);}}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  if(!saved){const partial=join(dir,key+'.partial.wav');try{await service.engine.render({plan,output:partial,tail_seconds:tail,sample_format:'float32'},{signal,timeout:15*60000,workDir:dir});const digest=await sha256(partial);await rename(partial,output);saved={hash:digest};await atomicJson(receipt,saved);}finally{await rm(partial,{force:true});}}
  const identity=comparisonIdentity(doc,{...args,comparison:slot,version_id:undefined});
  await atomicJson(join(dir,'version-'+identity+'.json'),{file:basename(output),hash:saved.hash});
  service.comparisonAudio.set(identity,{path:output,hash:saved.hash});identities.push(identity);paths.push(output);
 }
 // Bound disk cache as well as in-memory PCM. Never remove this session's pair.
 const entries=await Promise.all((await readdir(dir)).filter(n=>/^[a-f0-9]{64}\.wav$/.test(n)).map(async n=>({name:n,time:(await stat(join(dir,n))).mtimeMs})));
 for(const entry of entries.filter(e=>!keep.has(e.name.slice(0,-4))).sort((a,b)=>b.time-a.time).slice(Math.max(8,doc.mastering.songs.reduce((n:number,s:any)=>n+s.versions.length+2,0))-keep.size)){const key=entry.name.slice(0,-4);if(!keep.has(key)){await rm(join(dir,entry.name),{force:true});await rm(join(dir,key+'.json'),{force:true});for(const [id,value]of service.comparisonAudio)if(value.path===join(dir,entry.name))service.comparisonAudio.delete(id);}}
 return {paths,identities,slot:args.comparison==='b'?1:0};
}

/** Read-only cache lookup also works after a server restart and during playback. */
export async function cachedMasteringAudio(service:Service,doc:any,args:any){
 const target=resolveMasteringTarget(doc,args),engine=await service.engine.describe();
 const plan=audioPlan(await service.resolvedProject(compileDocument(doc,args)));
 const tail=target.selection.kind==='source'?0:target.version.tail_seconds;
 const key=comparisonCacheKey(engine.content_fingerprint,plan,tail,target.version.source_sha256),dir=join(service.dir(doc.id),'temp','mastering-preview');
 try{const record:any=await readJson(join(dir,key+'.json')),path=join(dir,key+'.wav');if(record.hash===await sha256(path))return {path,hash:record.hash};}catch(e:any){if(e.code!=='ENOENT')throw e;}
 return undefined;
}

/** Transport reads completed version audio; rendering belongs to the editing job. */
export async function loadExistingComparison(service:Service,doc:any,args:any){
 const engine=await service.engine.describe();
 if(!engine.features.includes('playback.prepared_comparison.v1'))return undefined;
 if((await getWorkingMix(service,doc.id)).entries.length)throw Error('未保存の調整があります。版を保存して音声生成を完了してください。');
 const paths:string[]=[],identities:string[]=[];let bytes=0;
 for(const comparison of ['a','b']){
  const targetArgs={...args,comparison,version_id:undefined},target=resolveMasteringTarget(doc,targetArgs);
  bytes+=(Number(target.version.duration_frames)+(target.selection.kind==='source'?0:target.version.tail_seconds*48000))*8;
  if(bytes>256*1024*1024)throw Error('比較音声が読み込み上限256 MiBを超えています。');
  const cached=await completedVersionAudio(service,doc,targetArgs);
  if(!cached)throw Error(`${comparison.toUpperCase()}の版の音声が未生成です。編集側でmastering_prepareを完了してください。`);
  paths.push(cached.path);identities.push(comparisonIdentity(doc,targetArgs));
 }
 return {paths,identities,slot:args.comparison==='b'?1:0};
}

export async function completedVersionAudio(service:Service,doc:any,args:any){
 const dir=join(service.dir(doc.id),'temp','mastering-preview'),index=join(dir,'version-'+comparisonIdentity(doc,args)+'.json');
 try{const record:any=await readJson(index);if(/^[a-f0-9]{64}\.wav$/.test(record.file)){const path=join(dir,record.file);if(record.hash===await sha256(path)){const audio={path,hash:record.hash};service.comparisonAudio.set(comparisonIdentity(doc,args),audio);return audio;}}}catch(e:any){if(e.code!=='ENOENT')throw e;}
 const cached=await cachedMasteringAudio(service,doc,args);
 if(cached)await atomicJson(index,{file:basename(cached.path),hash:cached.hash});
 return cached;
}
