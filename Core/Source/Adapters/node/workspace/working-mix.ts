import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {id} from '../../../Domain/schema.js';
import {atomicJson,locked,readJson} from './storage.js';
import type {Service} from '../../../Application/service.js';
export const workingDecision=z.object({action:z.literal('keep'),token:z.string()}).strict();
const targetSchema=z.object({kind:z.enum(['track','bus','mastering']),track_id:id.optional(),bus_id:id.optional(),song_id:id.optional(),version_id:id.optional()}).strict();
export const workingSet=z.object({project_id:id,base_revision:z.number().int().nonnegative(),expected_token:z.string(),target:targetSchema,values:z.object({gain_db:z.number().min(-96).max(12).optional(),pan:z.number().min(-1).max(1).optional()}).strict()}).strict();
export const workingResolve=z.object({project_id:id,token:z.string(),request_id:id,action:z.enum(['include','discard'])}).strict();
const file=(service:Service,p:string)=>join(service.dir(p),'state','working-mix.json');
const empty=()=>({schema_version:1,sequence:0,entries:{} as Record<string,any>,resolutions:{} as Record<string,any>});
async function read(service:Service,p:string){try{const r=await readJson(file(service,p));if(r.schema_version!==1||!Number.isInteger(r.sequence)||!r.entries||!r.resolutions)throw Error('Invalid working mix');return r as ReturnType<typeof empty>;}catch(e:any){if(e.code==='ENOENT')return empty();throw e;}}
const token=(r:ReturnType<typeof empty>)=>String(r.sequence);
const key=(p:string,t:any)=>t.kind==='mastering'?`${p}:song:${t.song_id}:${t.version_id}`:`${p}:${t.kind}:${t.kind==='track'?t.track_id:t.bus_id}`;
function target(doc:any,p:string,t:any){
 if(t.kind==='mastering'){
  const song=doc.mastering?.songs.find((s:any)=>s.id===t.song_id),v=song?.versions.find((v:any)=>v.id===t.version_id);
  if(!v||song.current_version_id!==v.id)throw Error('Mastering target is no longer current');
  return {...t,key:key(p,t),project_id:p,base_revision:doc.revision,name:song.name,gain_db:v.input_gain_db,pan:0};
 }
 if(doc.kind==='mastering')throw Error('Invalid composition target');
 const graph=doc.composition?.graph??doc.composition??doc.graph??doc;
 const item=(t.kind==='track'?graph.tracks:graph.buses)?.find((i:any)=>i.id===(t.kind==='track'?t.track_id:t.bus_id));
 if(!item)throw Error('Working mix target missing');
 return {...t,key:key(p,t),project_id:p,base_revision:doc.revision,name:item.name,gain_db:item.gain_db??0,pan:item.pan??0};
}
function status(doc:any,p:string,entry:any){try{const now=target(doc,p,entry.target);return Object.keys(entry.values).some(k=>now[k]!==entry.base_values[k])?'conflict':'pending';}catch{return 'conflict';}}
export async function getWorkingMix(service:Service,p:string){const [doc,r]=await Promise.all([service.readDocument(p),read(service,p)]);return {project_id:p,revision:doc.revision,token:token(r),entries:Object.entries(r.entries).map(([key,e])=>({key,...e,status:status(doc,p,e)}))};}
export async function setWorkingMix(service:Service,a:z.infer<typeof workingSet>){
 const doc=await service.readDocument(a.project_id);if(doc.revision!==a.base_revision)throw Error('Working mix revision conflict; reload before adjusting');
 const current=target(doc,a.project_id,a.target);if(a.target.kind==='mastering'&&a.values.pan!==undefined)throw Error('Mastering pan is not supported');
 return locked(join(service.dir(a.project_id),'temp','working-mix.lock'),async()=>{
  const r=await read(service,a.project_id);if(token(r)!==a.expected_token)throw Error('Working mix token conflict; reload before adjusting');
  const previous=r.entries[current.key];if(previous&&status(doc,a.project_id,previous)==='conflict')throw Error('Working mix conflicts with the saved project');
  const e=previous??{target:current,base_values:{},values:{}};
  for(const [k,v]of Object.entries(a.values)){if(e.base_values[k]===undefined)e.base_values[k]=current[k];if(v===e.base_values[k]){delete e.values[k];delete e.base_values[k];}else e.values[k]=v;}
  if(Object.keys(e.values).length)r.entries[current.key]=e;else delete r.entries[current.key];
  r.sequence++;await atomicJson(file(service,a.project_id),r);return {token:token(r)};
 });
}
export async function guardWorkingMix(service:Service,p:string,decision?:z.infer<typeof workingDecision>){
 const r=await read(service,p);if(!Object.keys(r.entries).length)return;
 if(decision?.action==='keep'&&decision.token===token(r))return;
 throw Error('GUI_ADJUSTMENTS_PENDING: '+JSON.stringify({project_id:p,token:token(r),entries:Object.values(r.entries),next:'Ask whether to include GUI changes, keep them pending, or discard them. Use working_mix_get/working_mix_resolve. For keep pass working_copy:{action:"keep",token}.'}));
}
export async function resolveWorkingMix(service:Service,a:z.infer<typeof workingResolve>){
 const dir=service.dir(a.project_id),lock=join(dir,'temp','working-mix.lock');
 let plan:any=await locked(lock,async()=>{const r=await read(service,a.project_id);const prior=r.resolutions[a.request_id];if(prior){if(prior.token!==a.token||prior.action!==a.action)throw Error('request_id reused with different resolution');return prior;}
  if(token(r)!==a.token)throw Error('Working mix token conflict; inspect again');
  const plan={token:a.token,action:a.action,entries:structuredClone(r.entries)};r.resolutions[a.request_id]=plan;await atomicJson(file(service,a.project_id),r);return plan;
 });
 if(plan.result)return plan.result;
 if(a.action==='include'&&!plan.operations){
  const doc:any=await service.readDocument(a.project_id),operations:any[]=[];
  for(const e of Object.values(plan.entries) as any[]){if(status(doc,a.project_id,e)==='conflict')throw Error('Working mix conflict; keep or discard the conflicting adjustments');
   if(e.target.kind==='mastering'){const song=doc.mastering.songs.find((s:any)=>s.id===e.target.song_id),parent=song.versions.find((v:any)=>v.id===e.target.version_id);const version={...parent,id:randomUUID(),parent_version_id:parent.id,label:'GUI mix',created_at:new Date().toISOString(),created_revision:doc.revision+1,input_gain_db:e.values.gain_db};operations.push({op:'add_version',song_id:song.id,version});}
   else operations.push({op:e.target.kind==='track'?'set_track':'set_bus',[e.target.kind==='track'?'track_id':'bus_id']:e.target.track_id??e.target.bus_id,changes:e.values});
  }
  plan=await locked(lock,async()=>{const r=await read(service,a.project_id),stored=r.resolutions[a.request_id];if(!stored.operations){stored.operations=operations;stored.base_revision=doc.revision;await atomicJson(file(service,a.project_id),r);}return stored;});
 }
 const result=a.action==='include'&&plan.operations.length?await service.apply({project_id:a.project_id,base_revision:plan.base_revision,request_id:a.request_id,operations:plan.operations,summary:'GUI mix adjustments',working_mix_resolution:true} as any):{project_id:a.project_id,revision:(await service.readDocument(a.project_id)).revision};
 return locked(lock,async()=>{
  const r=await read(service,a.project_id);if(r.resolutions[a.request_id].result)return r.resolutions[a.request_id].result;
  for(const [k,snapshot]of Object.entries(plan.entries) as [string,any][]){
   const current=r.entries[k];
   if(JSON.stringify(current)===JSON.stringify(snapshot)){delete r.entries[k];continue;}
   if(a.action!=='include')continue;
   // The user may have returned to the baseline while the commit was running.
   const remaining=current??{target:structuredClone(snapshot.target),base_values:{...snapshot.base_values},values:{...snapshot.base_values}};
   for(const [field,adopted]of Object.entries(snapshot.values)){
    const desired=remaining.values[field]??snapshot.base_values[field];
    if(desired===adopted){delete remaining.values[field];delete remaining.base_values[field];}
    else{remaining.values[field]=desired;remaining.base_values[field]=adopted;}
   }
   remaining.target={...remaining.target,...snapshot.values,base_revision:result.revision};
   if(snapshot.target.kind==='mastering')remaining.target.version_id=plan.operations.find((op:any)=>op.song_id===snapshot.target.song_id).version.id;
   remaining.target.key=key(a.project_id,remaining.target);delete r.entries[k];
   if(Object.keys(remaining.values).length)r.entries[remaining.target.key]=remaining;
  }
  r.sequence++;r.resolutions[a.request_id].result={...result,token:token(r),action:a.action};await atomicJson(file(service,a.project_id),r);return r.resolutions[a.request_id].result;
 });
}
