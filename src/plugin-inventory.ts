import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { cp, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { layout, newJob } from './layout.js';
import { atomicJson, readJson } from './storage.js';
import { Knowledge } from './knowledge.js';
import type { Service } from './service.js';

type Format = 'VST3'|'AudioUnit';
type Task = {format:Format;location:string;state:'pending'|'running'|'succeeded'|'failed';attempt?:number;plugins?:string[];indexed?:number;errors?:string[];error?:string};
type InventoryStatus = {id:string;state:'running'|'paused'|'succeeded'|'failed';created_at:string;updated_at:string;formats:Format[];tasks:Task[];summary?:any;portable_catalog?:string};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const portableError=(value:unknown,locations:string[])=>{
  let text=String(value instanceof Error?value.message:value);
  for(const location of [...locations].sort((a,b)=>b.length-a.length))text=text.split(location).join(`<plugin:${basename(location)}>`);
  return text.replace(/\/Users\/[^/\s]+\//g,'<user-home>/').replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g,'<user-home>\\').slice(0,2000);
};
const paramShape=(p:any)=>({id:String(p.id??''),name:String(p.name??''),unit:String(p.unit??''),automatable:!!p.automatable,steps:Number(p.steps??0),choices:Array.isArray(p.choices)?p.choices.map(String):[]});

export class PluginInventory {
  constructor(readonly service:Service){}
  get dir(){return join(this.service.root,'PluginLibrary.aidaw');}
  async start(formats:Format[],maxSeconds:number,resumeId?:string){
    if(formats.includes('AudioUnit')&&process.platform!=='darwin')throw new Error('AudioUnit inventory is available only on macOS');
    await layout(this.dir);
    let job:{id:string;path:string},status:InventoryStatus;
    if(resumeId){
      job={id:resumeId,path:join(this.dir,'jobs',resumeId)};status=await readJson(join(job.path,'status.json'));
      const request=await readJson<any>(join(job.path,'request.json'));if(request.kind!=='plugin_inventory')throw new Error('Not a plugin inventory job');
      formats=request.formats;
    }else{
      const candidates:Task[]=[];
      for(const format of formats){const found=await this.service.discover(format);for(const location of found.candidates)candidates.push({format,location:String(location),state:'pending'});}
      job=await newJob(this.dir,{kind:'plugin_inventory',formats,candidate_count:candidates.length});
      status={id:job.id,state:'running',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),formats,tasks:candidates};
    }
    const started=Date.now(),knowledge=new Knowledge(this.service);
    status.state='running';await this.save(job.path,status);
    for(const task of status.tasks){
      if(task.state==='succeeded'||task.state==='failed')continue;
      if(Date.now()-started>=maxSeconds*1000){status.state='paused';break;}
      task.state='running';task.attempt=(task.attempt??0)+1;await this.save(job.path,status);
      try{
        const scanned=await this.service.scan(task.format,task.location);task.plugins=scanned.plugins.map((p:any)=>p.plugin_id);task.indexed=0;task.errors=[];
        for(const p of scanned.plugins){
          try{
            const spec={kind:'plugin' as const,plugin_id:p.plugin_id,parameters:[]};const resolved=await this.service.resolvePlugin(spec);const info=await this.service.inspectPlugin(spec);
            await knowledge.put('parameters',{plugin_id:p.plugin_id,version:resolved.plugin_version,platform:process.platform,arch:process.arch,parameters:info.parameters,programs:info.programs,buses:info.buses,program_count:info.program_count,meaning_status:'unmapped',evidence:'inventory_host_parameter_readback',inventory_job_id:job.id});
            task.indexed++;
          }catch(e){const error=portableError(e,[task.location]);task.errors.push(error);await knowledge.put('compatibility',{plugin_id:p.plugin_id,platform:process.platform,arch:process.arch,status:'metadata_load_failed',error,inventory_job_id:job.id});}
        }
        task.state=task.errors.length?'failed':'succeeded';if(task.errors.length)task.error=`${task.errors.length} plugin metadata load failure(s)`;
      }catch(e){task.state='failed';task.error=portableError(e,[task.location]);}
      await this.save(job.path,status);
    }
    if(status.state==='running')status.state=status.tasks.some(t=>t.state==='pending'||t.state==='running')?'paused':'succeeded';
    status.summary=this.summarize(status);status.portable_catalog=await this.exportPortable(job.id,status);await this.save(job.path,status);return this.publicStatus(status);
  }
  async status(jobId:string){return this.publicStatus(await readJson(join(this.dir,'jobs',jobId,'status.json')));}
  private summarize(status:InventoryStatus){
    const plugins=new Set(status.tasks.flatMap(t=>t.plugins??[]));return {candidates:status.tasks.length,candidates_scanned:status.tasks.filter(t=>t.state==='succeeded'||t.state==='failed').length,candidates_succeeded:status.tasks.filter(t=>t.state==='succeeded').length,candidates_failed:status.tasks.filter(t=>t.state==='failed').length,plugins_found:plugins.size,plugins_parameter_indexed:status.tasks.reduce((n,t)=>n+(t.indexed??0),0),plugins_metadata_failed:status.tasks.reduce((n,t)=>n+(t.errors?.length??0),0)};
  }
  private publicStatus(status:InventoryStatus){return {...status,tasks:status.tasks.map(t=>({format:t.format,candidate:basename(t.location),state:t.state,attempt:t.attempt,plugins:t.plugins,indexed:t.indexed,errors:t.errors,error:t.error}))};}
  private async save(path:string,status:InventoryStatus){status.updated_at=new Date().toISOString();await atomicJson(join(path,'status.json'),status);}
  async exportPortable(jobId?:string,status?:InventoryStatus){
    if(jobId&&!status)status=await readJson(join(this.dir,'jobs',jobId,'status.json'));
    const catalog=await this.service.catalog(),records:any[]=[];const dbPath=join(this.dir,'state','catalog.sqlite');
    try{const db=new DatabaseSync(dbPath,{readOnly:true});try{for(const r of db.prepare("SELECT data FROM records WHERE kind='parameters' ORDER BY created DESC").all() as any[])records.push(JSON.parse(r.data));}finally{db.close();}}catch{}
    const latest=new Map<string,any>();for(const r of records){const key=`${r.plugin_id}\0${r.version}`;if(!latest.has(key))latest.set(key,r);}
    const locations=status?.tasks.map(t=>t.location)??catalog.plugins.map((p:any)=>String(p.location??''));
    const observed=status?new Set(status.tasks.flatMap(t=>t.plugins??[])):null;
    const included=(p:any)=>!observed||observed.has(p.plugin_id)||(p.vendor==='AIDAW'&&['AIDAW GM','AIDAW EQ','AIDAW Limiter','AIDAW Reverb'].includes(p.name));
    const plugins=catalog.plugins.filter(included).map((p:any)=>{const snapshot=latest.get(`${p.plugin_id}\0${p.version}`);return {plugin_id:p.plugin_id,name:p.name,vendor:p.vendor,version:p.version,format:p.format,instrument:!!p.instrument,inputs:Number(p.inputs??0),outputs:Number(p.outputs??0),parameter_status:snapshot?'host_readback':'not_indexed',parameters:(snapshot?.parameters??[]).map(paramShape),programs:(snapshot?.programs??[]).map((x:any)=>({index:Number(x.index),name:String(x.name??'')})),buses:(snapshot?.buses??[]).map((x:any)=>({direction:x.direction,index:Number(x.index),name:String(x.name??''),channels:Number(x.channels),enabled:!!x.enabled}))};}).sort((a:any,b:any)=>`${a.vendor}\0${a.name}\0${a.format}`.localeCompare(`${b.vendor}\0${b.name}\0${b.format}`));
    const failures=(status?.tasks??[]).filter(t=>t.state==='failed').map(t=>({format:t.format,candidate:basename(t.location),error:portableError(t.error??t.errors?.join('; ')??'unknown',locations)}));
    const summary=status?this.summarize(status):{plugins_found:plugins.length};
    const output={schema_version:1,scope:'observed host metadata; no plugin binaries, licenses, saved states or installation paths',platform:process.platform,arch:process.arch,summary:{...summary,catalog_plugins:plugins.length},plugins,failures};
    const path=join(this.dir,'outputs','portable-plugin-catalog.json');await atomicJson(path,output);return path;
  }
  async copyPortable(jobId:string,destination:string){const source=await this.exportPortable(jobId);await cp(source,destination);return {output:destination,sha256:hash(await readFile(destination,'utf8'))};}
  async searchReference(query:string,limit:number){
    const source=process.env.AIDAW_REFERENCE_CATALOG??new URL('../catalog/reference-plugins.json',import.meta.url);let catalog:any;
    try{catalog=JSON.parse(await readFile(source,'utf8'));}catch(e:any){if(e.code==='ENOENT')return {available:false,plugins:[],instruction:'Run npm run inventory:plugins to create the portable reference catalog.'};throw e;}
    const q=query.toLocaleLowerCase();const matches=(catalog.plugins??[]).filter((p:any)=>!q||`${p.name} ${p.vendor} ${p.version} ${p.format} ${p.parameters?.map((x:any)=>x.name).join(' ')} ${p.programs?.map((x:any)=>x.name).join(' ')}`.toLocaleLowerCase().includes(q));
    return {available:true,scope:catalog.scope,platform:catalog.platform,arch:catalog.arch,total:matches.length,plugins:matches.slice(0,limit).map((p:any)=>({plugin_id:p.plugin_id,name:p.name,vendor:p.vendor,version:p.version,format:p.format,instrument:p.instrument,parameter_count:p.parameters?.length??0,program_count:p.programs?.length??0,matched_parameters:(p.parameters??[]).filter((x:any)=>!q||`${x.name} ${x.unit}`.toLocaleLowerCase().includes(q)).slice(0,20),matched_programs:(p.programs??[]).filter((x:any)=>!q||x.name.toLocaleLowerCase().includes(q)).slice(0,20),availability:'reference_only; scan the exact format and version on this server before use'}))};
  }
}
