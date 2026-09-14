import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
const text=z.string().max(256).refine(s=>!/(?:[A-Za-z]:[\\/]|\/(?:Users|home|Library|tmp|var|mnt)\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:token|password|secret|api[_-]?key)\s*[:=]|-----BEGIN|[\x00-\x1f])/.test(s),'Potential private text; review metadata before sharing');
const parameter=z.object({id:text.min(1),name:text,unit:text,automatable:z.boolean(),steps:z.number().int().nonnegative()}).strict();
export const observation=z.object({schema_version:z.literal(1),kind:z.literal('plugin_parameter_observation'),platform:z.enum(['darwin','win32','linux']),arch:z.enum(['arm64','x64','ia32','arm']),plugin:z.object({plugin_id:text.min(1),name:text.min(1),vendor:text,version:text.min(1),format:z.enum(['VST3','AudioUnit']),parameters:z.array(parameter).max(20000)}).strict()}).strict().superRefine((r,c)=>{if(new Set(r.plugin.parameters.map(p=>p.id)).size!==r.plugin.parameters.length)c.addIssue({code:'custom',message:'Duplicate parameter ID'});if(r.plugin.format==='AudioUnit'&&r.platform!=='darwin')c.addIssue({code:'custom',message:'AudioUnit requires macOS'});});
export function canonicalObservation(input:unknown){const data=observation.parse(input);data.plugin.parameters.sort((a,b)=>a.id.localeCompare(b.id,'en'));return data;}
export function contributionFromPortable(input:any,ids:string[]){
 if(!ids.length||new Set(ids).size!==ids.length)throw Error('Select distinct plugin IDs');
 return ids.map(id=>{const p=input.plugins.find((p:any)=>p.plugin_id===id);if(!p||p.parameter_status!=='host_readback')throw Error(`Plugin is not parameter indexed: ${id}`);
 return canonicalObservation({schema_version:1,kind:'plugin_parameter_observation',platform:input.platform,arch:input.arch,plugin:{plugin_id:p.plugin_id,name:p.name,vendor:p.vendor,version:p.version,format:p.format,parameters:p.parameters.map((x:any)=>({id:x.id,name:x.name,unit:x.unit,automatable:x.automatable,steps:x.steps}))}});});
}
export async function saveObservation(directory:string,input:unknown){
 const data=canonicalObservation(input),body=JSON.stringify(data,null,2)+'\n',hash=createHash('sha256').update(body).digest('hex');
 if(Buffer.byteLength(body)>4*1024*1024)throw Error('Observation exceeds 4 MiB');
 await mkdir(directory,{recursive:true});if((await lstat(directory)).isSymbolicLink())throw Error('Symlink contribution directory refused');
 const path=join(directory,hash+'.json');
 try{await writeFile(path,body,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;if((await lstat(path)).isSymbolicLink()||await readFile(path,'utf8')!==body)throw Error('Existing contribution differs');}
 return {path,sha256:hash,plugin_id:data.plugin.plugin_id,version:data.plugin.version,parameter_count:data.plugin.parameters.length};
}
export async function readObservation(path:string){const info=await lstat(path);if(!info.isFile()||info.size>4*1024*1024)throw Error('Expected observation JSON under 4 MiB');return canonicalObservation(JSON.parse(await readFile(path,'utf8')));}
export async function referenceObservations(directory:string){let names:string[];try{names=await readdir(directory);}catch(e:any){if(e.code==='ENOENT')return [];throw e;}const results=[];for(const name of names.sort()){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const r=await readObservation(join(directory,name));if(createHash('sha256').update(JSON.stringify(r,null,2)+'\n').digest('hex')!==name.slice(0,-5))throw Error('Observation hash mismatch');results.push({...r.plugin,platform:r.platform,arch:r.arch,observation_id:name.slice(0,-5),parameter_status:'host_readback',programs:[]});}return results;}
