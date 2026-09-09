import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, lstat, realpath } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { atomicJson, readJson, locked } from './storage.js';
import { layout, newJob } from './layout.js';
import { sha256 } from './assets.js';
import { Knowledge } from './knowledge.js';
import type { Service } from './service.js';
const run=promisify(execFile);
const identifier=(s:string)=>createHash('sha256').update(s).digest('hex');
export function niPath(value:string){if(!value.includes(':')||/^[A-Za-z]:[\\/]/.test(value))return value;if(value.startsWith('Macintosh HD:'))return '/'+value.slice(13).replace(/:/g,'/').replace(/\/$/,'');if(value.startsWith('/:'))return '/'+value.slice(2).replace(/:/g,'/').replace(/\/$/,'');return value;}
export interface ContentRoot{id:string;name:string;path:string;origin:string;family:string;available:boolean}
interface Item{id:string;root_id:string;library:string;family:string;name:string;path:string;relative_path:string;format:string;bytes:number;modified_ms:number;load_status:string;metadata_evidence:string}
const family=(name:string)=>/kontakt|kinetic metal|damage/i.test(name)?'Kontakt':/massive x/i.test(name)?'Massive X':/massive/i.test(name)?'Massive':/absynth/i.test(name)?'Absynth':/fm8/i.test(name)?'FM8':/battery/i.test(name)?'Battery':/reaktor|razor|prism/i.test(name)?'Reaktor':'unknown';
const formats=new Set(['.nbkt','.rkplr','.nmsv','.nabs','.nfm8','.ksd','.nki','.nkm','.nksn','.nksf','.nksfx','.b4kit','.ens','.ism','.nrkt','.vstpreset','.fxp','.fxb']);
export class ContentCatalog {
 constructor(readonly service:Service){}
 get dir(){return join(this.service.root,'PluginLibrary.aidaw');}
 get file(){return join(this.dir,'state','content-catalog.json');}
 async read():Promise<{schema_version:1;roots:ContentRoot[];items:Item[];bindings:any[]}>{try{return await readJson(this.file);}catch(e:any){if(e.code==='ENOENT')return {schema_version:1,roots:[],items:[],bindings:[]};throw e;}}
 async discover(){
  const roots:ContentRoot[]=[],gaps:string[]=[];
  const add=async(name:string,path:string,origin:string)=>{path=niPath(path);if(!path.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(path))return;roots.push({id:identifier(path),name,path,origin,family:family(name),available:await stat(path).then(s=>s.isDirectory()).catch(()=>false)});};
  if(process.platform==='darwin'){
   for(const base of ['/Library/Preferences',join(homedir(),'Library/Preferences')])for(const name of await readdir(base).catch(()=>[]))if(/^com\.native-instruments\..*\.plist$/i.test(name))try{
    const result=await run('/usr/bin/plutil',['-convert','json','-o','-',join(base,name)],{maxBuffer:1024*1024});const p=JSON.parse(result.stdout);
    for(const key of ['ContentDir','ContentPath'])if(typeof p[key]==='string')await add(name.replace(/^com\.native-instruments\./,'').replace(/\.plist$/,''),p[key],'NI registered content path');
   }catch{gaps.push(`Could not read registration ${name}`);}
   await add('NI shared content','/Users/Shared/Native Instruments','conventional directory');await add('NI user content',join(homedir(),'Documents/Native Instruments/User Content'),'conventional directory');
  }else if(process.platform==='win32'){
   for(const key of ['HKLM\\SOFTWARE\\Native Instruments','HKLM\\SOFTWARE\\WOW6432Node\\Native Instruments','HKCU\\SOFTWARE\\Native Instruments'])try{
    const result=await run('reg.exe',['query',key,'/s'],{maxBuffer:8*1024*1024});let product='';for(const line of result.stdout.split(/\r?\n/)){if(line.startsWith('HKEY'))product=line.trim().split('\\').pop()!;const m=line.match(/^\s+(ContentDir|ContentPath)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);if(m)await add(product,m[2].trim().replace(/%([^%]+)%/g,(_,v)=>process.env[v]??`%${v}%`),'NI registry content path');}
   }catch{gaps.push(`Registration unavailable: ${key}`);}
   await add('NI shared content',join(process.env.PUBLIC??'C:\\Users\\Public','Documents/Native Instruments'),'conventional directory');await add('NI user content',join(homedir(),'Documents/Native Instruments/User Content'),'conventional directory');
  }else gaps.push('Automatic vendor registration discovery unavailable on this OS; register explicit roots');
  await layout(this.dir);await locked(join(this.dir,'temp','content.lock'),async()=>{const c=await this.read();for(const root of roots){c.roots=c.roots.filter(r=>r.id!==root.id);c.roots.push(root);}await atomicJson(this.file,c);});
  return {roots,gaps,coverage:'Registered paths and conventional NI user/shared directories; not all disks. Register additional third-party roots explicitly.'};
 }
 async register(name:string,path:string,hostFamily:string){path=await realpath(path);if(!(await stat(path)).isDirectory())throw new Error('Content root must be a directory');const root={id:identifier(path),name,path,origin:'explicit root',family:hostFamily,available:true};await layout(this.dir);await locked(join(this.dir,'temp','content.lock'),async()=>{const c=await this.read();c.roots=c.roots.filter(r=>r.id!==root.id);c.roots.push(root);await atomicJson(this.file,c);});return root;}
 async index(rootIds:string[],maxFiles:number,maxSeconds:number){
  await layout(this.dir);const c=await this.read();const roots=c.roots.filter(r=>!rootIds.length||rootIds.includes(r.id));if(rootIds.some(id=>!roots.some(r=>r.id===id)))throw new Error('Unknown content root');
  const job=await newJob(this.dir,{kind:'content_index',root_ids:rootIds,max_files:maxFiles,max_seconds:maxSeconds});
  const found:Item[]=[],errors:any[]=[],completed:string[]=[];let visited=0,truncated=false;const deadline=Date.now()+maxSeconds*1000;
  async function walk(root:ContentRoot,path:string,depth:number){if(visited>=maxFiles||Date.now()>deadline){truncated=true;return;}if(depth>24){errors.push({path,error:'Depth limit'});return;}
   let entries;try{entries=await readdir(path,{withFileTypes:true});}catch(e){errors.push({path,error:String(e)});return;}
   for(const entry of entries){if(visited>=maxFiles||Date.now()>deadline){truncated=true;return;}visited++;if(entry.isSymbolicLink())continue;const full=join(path,entry.name);if(entry.isDirectory()){if(!/^samples?$|^\.previews$|^\.git$/i.test(entry.name))await walk(root,full,depth+1);}
    else if(entry.isFile()&&formats.has(extname(entry.name).toLowerCase())){let info;try{info=await lstat(full);if(!info.isFile())continue;}catch(e){errors.push({path:full,error:String(e)});continue;}const format=extname(entry.name).toLowerCase();const host=['.nki','.nkm','.nksn'].includes(format)?'Kontakt':['.b4kit','.nbkt'].includes(format)?'Battery':['.ens','.ism','.nrkt','.rkplr'].includes(format)?'Reaktor':format==='.nmsv'?'Massive':format==='.nabs'?'Absynth':format==='.nfm8'?'FM8':root.family;
     found.push({id:identifier(root.id+':'+relative(root.path,full)),root_id:root.id,library:root.name,family:host,name:basename(entry.name,format),path:full,relative_path:relative(root.path,full),format,bytes:info.size,modified_ms:info.mtimeMs,load_status:'discovered_not_loaded',metadata_evidence:'registered root and file/folder name; not audio assessment'});
    }
   }
  }
  for(const root of roots){if(truncated)break;const n=errors.length;await walk(root,root.path,0);if(!truncated&&errors.length===n)completed.push(root.id);}
  await locked(join(this.dir,'temp','content.lock'),async()=>{const current=await this.read();current.items=current.items.filter(i=>!completed.includes(i.root_id)&&!found.some(f=>f.id===i.id));current.items.push(...found);await atomicJson(this.file,current);});
  const report={job_id:job.id,indexed:found.length,visited,truncated,completed_roots:completed,errors,state:errors.length?'partial':truncated?'partial':'succeeded'};await atomicJson(join(job.path,'status.json'),report);return report;
 }
 async search(query:string,hostFamily:string|undefined,limit:number,offset:number){const c=await this.read(),tokens=query.toLocaleLowerCase().split(/\s+/).filter(Boolean),catalog=await this.service.catalog();
  const matched=c.items.filter(i=>(!hostFamily||i.family.toLowerCase()===hostFamily.toLowerCase())&&tokens.every(t=>`${i.library} ${i.name} ${i.relative_path} ${i.family}`.toLocaleLowerCase().includes(t)));
  const items=[];for(const i of matched.slice(offset,offset+limit)){const exists=await stat(i.path).then(s=>s.isFile()).catch(()=>false);items.push({...i,available_on_disk:exists,host_candidates:catalog.plugins.filter(p=>p.instrument&&i.family!=='unknown'&&p.name.toLowerCase().includes(i.family.toLowerCase())).map(p=>({plugin_id:p.plugin_id,name:p.name,version:p.version})),bindings:c.bindings.filter(b=>b.content_id===i.id),load_requirement:i.family==='Kontakt'?'NKI/NKSN discovery is not loading. Requires verified Kontakt adapter or an explicitly identified saved state. License/content compatibility remains unverified.':'Use a matching verified format adapter or saved plugin state.'});}
  return {items,total:matched.length,offset,selection_policy:'Inspect library and patch, audition then choose; do not fall back to General MIDI automatically'};
 }
 async bind(contentId:string,presetId:string,probeId:string,description:string){const c=await this.read(),item=c.items.find(i=>i.id===contentId);if(!item)throw new Error('Unknown content');const preset=(await this.service.catalog()).presets.find(p=>p.id===presetId),probe=await new Knowledge(this.service).get(probeId);if(!preset||probe.plugin_id!==preset.plugin_id||probe.source_preset_id!==presetId)throw new Error('Probe must originate from the exact saved preset');if(!probe.path||await sha256(probe.path)!==probe.audio_sha256)throw new Error('Probe audio unavailable or changed');
  const binding={content_id:contentId,content_sha256:await sha256(item.path),preset_id:presetId,plugin_id:preset.plugin_id,plugin_version:preset.plugin_version,probe_id:probeId,description,evidence:'caller_identified_library_patch_with_saved_preset_and_audio; content identity not independently proved',created_at:new Date().toISOString()};
  await locked(join(this.dir,'temp','content.lock'),async()=>{const current=await this.read();current.bindings.push(binding);await atomicJson(this.file,current);});return binding;
 }
}
export const contentDefinitions={
 content_discover_roots:{description:'Read NI registered content locations on Mac/Windows and known user/shared directories. Does not load instruments or infer licensing.',schema:z.object({}).strict()},
 content_register_root:{description:'Add an explicit third-party sample library/preset root without moving or changing its files.',schema:z.object({name:z.string().min(1).max(200),path:z.string().min(1),family:z.string().max(100).default('unknown')}).strict()},
 content_index:{description:'Index instrument patches INSIDE registered libraries (.nki/.nksn/.nksf/.nbkt/.nmsv/.ens etc). Bounded scan; reports gaps, not false completeness.',schema:z.object({root_ids:z.array(z.string().regex(/^[a-f0-9]{64}$/)).default([]),max_files:z.number().int().min(1).max(200000).default(50000),max_seconds:z.number().int().min(1).max(120).default(30)}).strict()},
 content_search:{description:'Find library/patch-level candidates and host plugin links. Discovered files are NOT certified loadable or auditioned.',schema:z.object({query:z.string().max(500).default(''),family:z.string().max(100).optional(),limit:z.number().int().min(1).max(100).default(20),offset:z.number().int().min(0).default(0)}).strict()},
 content_bind_preset:{description:'Link a caller-identified library patch to an exact saved preset and its actual probe audio. Does not claim independent proof of patch identity.',schema:z.object({content_id:z.string().regex(/^[a-f0-9]{64}$/),preset_id:z.string().uuid(),probe_id:z.string().uuid(),description:z.string().min(1).max(2000)}).strict()},
};
