import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname, extname } from 'node:path';
import { z } from 'zod';
import { atomicJson, locked, readJson } from './storage.js';
import type { Service } from './service.js';
export async function sha256(path:string){const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex');}
export const assetSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}-(source|reference|artwork|frozen|derived)$/),path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),role:z.enum(['source','reference','artwork','frozen','derived']),name:z.string(),parents:z.array(z.string()),audio:z.record(z.string(),z.unknown()).optional()}).strict();
export type Asset=z.infer<typeof assetSchema>;
export interface Manifest{schema_version:1;assets:Asset[]}
export function portablePath(path:string){
 if(!path||path.includes('\\')||isAbsolute(path)||path.includes(':')||(/[<>:"|?*\x00-\x1F]/.test(path))||path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))throw new Error(`Unsafe portable path: ${path}`);return path;
}
export async function contained(root:string,path:string){
 portablePath(path);const full=resolve(root,path),base=await realpath(root),actual=await realpath(full),rel=relative(base,actual);
 if(rel==='..'||rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`)||isAbsolute(rel))throw new Error('Asset escapes project directory');
 if((await lstat(full)).isSymbolicLink())throw new Error('Symlink assets are not portable');return full;
}
export async function manifest(dir:string):Promise<Manifest>{try{const m=await readJson(join(dir,'manifest.json'));if(m.schema_version!==1)throw new Error('Unsupported asset manifest version');const assets=z.array(assetSchema).parse(m.assets);for(const a of assets)if(a.id!==`${a.sha256}-${a.role}`)throw new Error('Asset identity mismatch');return {schema_version:1,assets};}catch(e:any){if(e.code==='ENOENT')return {schema_version:1,assets:[]};throw e;}}
export async function ingest(service:Service,projectId:string,path:string,role:Asset['role'],parents:string[]=[]){
 const dir=service.dir(projectId);await service.read(projectId);
 return locked(join(dir,'temp','assets.lock'),async()=>{
  const m=await manifest(dir);for(const p of parents)if(!m.assets.some(a=>a.id===p))throw new Error('Unknown parent asset');
  if(['derived','frozen'].includes(role)&&!parents.length)throw new Error('Derived audio requires parent provenance');
  const hash=await sha256(path),id=`${hash}-${role}`;const previous=m.assets.find(a=>a.id===id);if(previous){await verifyAsset(dir,previous);return previous;}
  const suffix=role==='artwork'?extname(path).toLowerCase():'.wav';if(role==='artwork'&&!['.jpg','.jpeg','.png'].includes(suffix))throw new Error('Artwork must be JPEG or PNG');
  const target=role==='source'||role==='reference'||role==='artwork'?`assets/${role}/${hash}${suffix}`:`state/frozen/${hash}.wav`;
  const dest=join(dir,target);await mkdir(dirname(dest),{recursive:true});await copyFile(path,dest);if(await sha256(dest)!==hash)throw new Error('Asset changed while copying');
  const audio=role==='artwork'?undefined:await service.engine.call({command:'analyze',path:dest});
  const record=assetSchema.parse({id,path:target,sha256:hash,role,name:path.split(/[\\/]/).pop(),parents,audio});
  m.assets.push(record);await atomicJson(join(dir,'manifest.json'),m);return record;
 });
}
export async function verifyAsset(dir:string,a:Asset){const path=await contained(dir,a.path);if(await sha256(path)!==a.sha256)throw new Error(`Asset hash mismatch: ${a.id}`);return path;}
export async function inputAsset(dir:string,id:string){
 const m=await manifest(dir),a=m.assets.find(a=>a.id===id);if(!a)throw new Error(`Missing asset ${id}`);
 const seen=new Set<string>();const visit=(v:Asset)=>{if(seen.has(v.id))throw new Error('Cyclic asset ancestry');if(v.role==='reference'||v.role==='artwork')throw new Error('Reference/artwork cannot be a render input');seen.add(v.id);for(const parent of v.parents){const p=m.assets.find(x=>x.id===parent);if(!p)throw new Error('Missing asset ancestor');visit(p);}seen.delete(v.id);};visit(a);
 if(a.audio?.sample_rate!==48000)throw new Error('Audio input requires explicit conversion to 48000 Hz');return {asset:a,path:await verifyAsset(dir,a)};
}
