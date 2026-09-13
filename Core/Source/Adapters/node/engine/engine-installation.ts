import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, realpathSync, statSync, existsSync} from 'node:fs';
import {mkdir, copyFile, chmod, rename, rm, readFile} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultWorkspaceRoot,homePaths} from '../workspace/home.js';
import {atomicJson} from '../workspace/storage.js';

const executableName=process.platform==='win32'?'aidaw-engine.exe':'aidaw-engine';
const platformKey=`${process.platform}-${process.arch}`;
export const defaultEngineExecutable=()=>join(defaultWorkspaceRoot(),'Core','Build','Native','bin',executableName);
function contained(base:string,target:string){const path=relative(realpathSync(base),realpathSync(target));if(path==='..'||path.startsWith('../')||path.startsWith('..\\')||isAbsolute(path))throw Error('Engine installation escapes its directory');return target;}
/** Only explicit installation manifests are executable discovery roots. Invalid installations fail closed. */
export function resolveEngineExecutable(root?:string,fallback?:string):string{
 if(process.env.AIDAW_ENGINE)return resolve(process.env.AIDAW_ENGINE);
 if(root){
  const base=homePaths(root).engine,manifest=join(base,'manifest.json');
  if(existsSync(manifest)){
   const m=JSON.parse(readFileSync(manifest,'utf8'));
   if(m.schema_version!==1||m.protocol_version!==1||m.platform!==process.platform||m.arch!==process.arch||typeof m.executable!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('Invalid or incompatible home engine manifest');
   const executable=contained(base,resolve(base,m.executable));
   if(!statSync(executable).isFile()||createHash('sha256').update(readFileSync(executable)).digest('hex')!==m.sha256)throw Error('Home engine integrity check failed');
   return executable;
  }
 }
 if(root&&!fallback)throw Error('AIDAW home engine is not installed; run setup before starting the application');
 return resolve(fallback??defaultEngineExecutable());
}
/** Publish an immutable content-addressed executable, then atomically select its manifest. */
export async function installEngine(root:string,sourceExecutable:string,options:{version?:string}={}){
 const bytes=await readFile(sourceExecutable),sha256=createHash('sha256').update(bytes).digest('hex');
 const base=homePaths(root).engine,folder=join(base,platformKey,sha256),target=join(folder,executableName);
 await mkdir(folder,{recursive:true});
 const pending=join(folder,`.${randomUUID()}.tmp`);
 try{await copyFile(sourceExecutable,pending);const copied=createHash('sha256').update(await readFile(pending)).digest('hex');if(copied!==sha256)throw Error('Engine source changed during installation');await chmod(pending,0o755);if(existsSync(target)){if(createHash('sha256').update(await readFile(target)).digest('hex')!==sha256)throw Error('Existing immutable engine is corrupt');}else await rename(pending,target);}finally{await rm(pending,{force:true});}
 const manifest={schema_version:1,protocol_version:1,version:options.version??'development',platform:process.platform,arch:process.arch,executable:`${platformKey}/${sha256}/${executableName}`,sha256,installed_at:new Date().toISOString()};
 await atomicJson(join(base,'manifest.json'),manifest);return {...manifest,path:target};
}
export function resolveEngineSoundfont(root:string|undefined,executable:string):string|undefined{
 if(process.env.AIDAW_SOUNDFONT)return resolve(process.env.AIDAW_SOUNDFONT);
 if(root){const bank=join(homePaths(root).instruments,'aidaw-gm','Resources','FluidR3_GM.sf2');if(existsSync(bank))return bank;return undefined;}
 return resolve(executable,'../../starter-assets/FluidR3_GM.sf2');
}
