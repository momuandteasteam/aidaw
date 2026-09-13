import {homePaths} from '../workspace/home.js';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

export interface PluginPackageManifest {schema_version:1;package_id:string;version:string;category:'instrument'|'effect';format:'VST3';entry:string;platform:string;arch:string;resources?:Record<string,{path:string;sha256:string}>}
const inside=(base:string,target:string)=>{const rel=relative(base,target);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
export async function readPluginPackage(directory:string,verifyResources=true){
 const base=await realpath(directory),m=JSON.parse(await readFile(join(base,'manifest.json'),'utf8')) as PluginPackageManifest;
 if(m.schema_version!==1||!/^[-a-z0-9]+$/.test(m.package_id)||typeof m.version!=='string'||!m.version||!['instrument','effect'].includes(m.category)||m.format!=='VST3'||m.platform!==process.platform||m.arch!==process.arch)throw Error(`Invalid or incompatible plugin manifest: ${directory}`);
 const contained=async(p:unknown)=>{if(typeof p!=='string'||!p||isAbsolute(p)||p.includes('\\')||p.split('/').includes('..'))throw Error('Invalid plugin package relative path');const target=await realpath(resolve(base,p));if(!inside(base,target))throw Error('Plugin package path escapes package');return target;};
 const entry=await contained(m.entry);if(!m.entry.endsWith('.vst3')||!(await stat(entry)).isDirectory())throw Error('Plugin entry must be a complete VST3 bundle');
 if(m.resources!==undefined&&(typeof m.resources!=='object'||m.resources===null||Array.isArray(m.resources)))throw Error('Invalid plugin resources');
 for(const resource of Object.values(m.resources??{})){
  if(!resource||typeof resource.sha256!=='string'||!/^[a-f0-9]{64}$/.test(resource.sha256))throw Error('Invalid plugin resource checksum');
  const path=await contained(resource.path);if(!(await stat(path)).isFile())throw Error('Invalid plugin resource file');
  if(verifyResources&&createHash('sha256').update(await readFile(path)).digest('hex')!==resource.sha256)throw Error(`Plugin resource checksum mismatch: ${resource.path}`);
 }
 return {manifest:m,directory:base,entry};
}
/** Discovery reads declarative packages only; no native code is loaded until catalog_scan. */
export async function discoverManagedPlugins(root:string){
 const candidates:string[]=[],errors:Array<{path:string;error:string}>=[];
 const walk=async(directory:string,category:'instrument'|'effect',depth:number)=>{
  let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(e:any){if(e.code==='ENOENT')return;throw e;}
  if(entries.some(e=>e.name==='manifest.json')){
   try{const p=await readPluginPackage(directory,false);if(p.manifest.category!==category)throw Error('Plugin category does not match containing directory');candidates.push(p.entry);}catch(e){errors.push({path:directory,error:String(e instanceof Error?e.message:e)});}return;
  }
  for(const entry of entries){if(entry.name.startsWith('.')||!entry.isDirectory())continue;const path=join(directory,entry.name);if(entry.name.endsWith('.vst3'))candidates.push(await realpath(path));else if(depth<4)await walk(path,category,depth+1);}
 };
 const paths=homePaths(root);await walk(paths.instruments,'instrument',0);await walk(paths.effects,'effect',0);
 return {candidates:[...new Set(candidates)],errors};
}
