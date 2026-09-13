// Pinned, bounded and atomic downloads. No platform-specific archive tool required.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,access,cp,readdir,lstat,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
export const bankHash='74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0';
export const archiveHash='2621acaa1c78e4abdb24bdd163230cc577e61276936d6aa6e3180582142f0343';
const url='https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont_3.1.orig.tar.gz';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function unpackBank(archive){
 if(sha(archive)!==archiveHash)throw Error('Starter archive checksum mismatch');
 const tar=gunzipSync(archive,{maxOutputLength:200*1024*1024}),files={};
 const allowed=new Map([['fluid-soundfont-3.1/FluidR3_GM.sf2','FluidR3_GM.sf2'],['fluid-soundfont-3.1/COPYING','FluidR3-LICENSE.txt'],['fluid-soundfont-3.1/README','FluidR3-README.txt']]);
 for(let i=0;i+512<=tar.length;){
  const header=tar.subarray(i,i+512);if(header.every(x=>x===0))break;
  const name=header.toString('utf8',0,100).split('\0')[0];const size=parseInt(header.toString('ascii',124,136).replace(/\0/g,'').trim(),8);
  if(!Number.isSafeInteger(size)||size<0||i+512+size>tar.length)throw Error('Invalid starter archive');
  const dest=allowed.get(name);if(dest){if(![0,48].includes(header[156])||files[dest])throw Error('Invalid starter member');files[dest]=tar.subarray(i+512,i+512+size);}
  i+=512+Math.ceil(size/512)*512;
 }
 if(!files['FluidR3-LICENSE.txt']||!files['FluidR3-README.txt']||sha(files['FluidR3_GM.sf2']??Buffer.alloc(0))!==bankHash)throw Error('Incomplete starter pack');
 return files;
}
export async function installStarter(build,{fetcher=fetch,libraryRoot}={}){
 const dest=join(build,'starter-assets');await mkdir(dest,{recursive:true});
 const bank=join(dest,'FluidR3_GM.sf2');
 const names=['FluidR3-LICENSE.txt','FluidR3-README.txt','FluidR3_GM.sf2'];
 const copyBank=async(from,to)=>{await mkdir(to,{recursive:true});for(const name of names){const pending=join(to,`.${randomUUID()}.tmp`);try{await cp(join(from,name),pending);await rename(pending,join(to,name));}finally{await rm(pending,{force:true});}}};
 const complete=async(reused)=>{if(libraryRoot){let valid=false;try{valid=sha(await readFile(join(libraryRoot,'FluidR3_GM.sf2')))===bankHash;for(const n of names.slice(0,2))await access(join(libraryRoot,n));}catch{valid=false;}if(!valid)await copyBank(dest,libraryRoot);}return {bank,library_bank:libraryRoot?join(libraryRoot,'FluidR3_GM.sf2'):undefined,sha256:bankHash,reused};};
 if(libraryRoot){try{if(sha(await readFile(join(libraryRoot,'FluidR3_GM.sf2')))===bankHash){for(const name of names)await access(join(libraryRoot,name));await copyBank(libraryRoot,dest);return complete(true);}}catch{}}
 try{if(sha(await readFile(bank))===bankHash){await access(join(dest,'FluidR3-LICENSE.txt'));await access(join(dest,'FluidR3-README.txt'));return complete(true);}}catch{}
 console.log('[setup] Downloading FluidR3 GM (129 MiB, MIT); verifying SHA-256.');
 const response=await fetcher(url,{signal:AbortSignal.timeout(300000)});if(!response.ok||!response.body)throw Error(`Starter download failed: HTTP ${response.status}`);
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>140*1024*1024)throw Error('Starter download exceeds size limit');chunks.push(chunk);}
 const files=unpackBank(Buffer.concat(chunks));
 // Publish the bank last, only after its mandatory notices have been saved.
 for(const name of ['FluidR3-LICENSE.txt','FluidR3-README.txt','FluidR3_GM.sf2']){
  const tmp=join(dest,`.${randomUUID()}.tmp`);try{await writeFile(tmp,files[name],{flag:'wx'});await rename(tmp,join(dest,name));}finally{await rm(tmp,{force:true});}
 }
 return complete(false);
}
/** Hash a complete native bundle including link targets; preserve its contents when copying. */
async function treeHash(directory){
 const hash=createHash('sha256');
 const walk=async(path,prefix='')=>{for(const name of (await readdir(path)).sort()){
  const source=join(path,name),key=prefix+name,info=await lstat(source);hash.update(key+'\0');
  if(info.isSymbolicLink())hash.update('link:'+await readlink(source));
  else if(info.isDirectory()){hash.update('dir');await walk(source,key+'/');}
  else if(info.isFile()){hash.update('file');hash.update(await readFile(source));}
  else throw Error('Unsupported file in native plugin package');
 }};await walk(directory);return hash.digest('hex');
}
async function installStarterPackages(root,build){
 const {homePaths}=await import('../../Build/JS/Adapters/node/workspace/home.js');const paths=homePaths(root);
 const installed=[];
 for(const name of ['GM','EQ','Limiter','Reverb']){
  const slug=name.toLowerCase(),parent=name==='GM'?paths.instruments:paths.effects,destination=join(parent,`aidaw-${slug}`);
  await mkdir(parent,{recursive:true});const stage=join(parent,`.aidaw-${slug}-${randomUUID()}.tmp`),backup=destination+`.previous-${randomUUID()}`;
  await mkdir(stage);
  try{
   const entry=`AIDAW ${name}.vst3`;
   await cp(join(build,`starter/aidaw-starter-${slug}_artefacts`,'Release','VST3',entry),join(stage,entry),{recursive:true,verbatimSymlinks:true});
   const manifest={schema_version:1,package_id:`aidaw-${slug}`,version:'0.1.0',category:name==='GM'?'instrument':'effect',format:'VST3',entry,platform:process.platform,arch:process.arch};
   if(name==='GM'){
    await mkdir(join(stage,'Resources'));
    for(const resource of ['FluidR3_GM.sf2','FluidR3-LICENSE.txt','FluidR3-README.txt'])await cp(join(build,'starter-assets',resource),join(stage,'Resources',resource));
    manifest.resources={soundfont:{path:'Resources/FluidR3_GM.sf2',sha256:bankHash}};
   }
   await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
   const {readPluginPackage}=await import('../../Build/JS/Adapters/node/engine/plugin-packages.js');await readPluginPackage(stage);
   const desired=await treeHash(stage);let previous;
   try{previous=await treeHash(destination);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(previous===desired){installed.push({name,directory:destination,entry:join(destination,entry),reused:true,sha256:desired});continue;}
   // Caller holds the shared audio lane: no active worker can retain these modules.
   let moved=false;
   try{if(previous){await rename(destination,backup);moved=true;}await rename(stage,destination);}
   catch(error){if(moved)await rename(backup,destination);throw error;}
   if(moved)await rm(backup,{recursive:true,force:true});
   installed.push({name,directory:destination,entry:join(destination,entry),reused:false,sha256:desired});
  }finally{await rm(stage,{recursive:true,force:true});}
 }
 return installed;
}
export async function registerStarter(service,build){
 return service.processing.run('install_standard_plugins',async()=>{
  const installed=await installStarterPackages(service.root,build),plugins=[];
  const {Knowledge}=await import('../../Build/JS/Application/knowledge.js');const knowledge=new Knowledge(service);
  for(const item of installed){
   const scan=await service.scan('VST3',item.entry);
   const plugin=scan.plugins.find(p=>p.name===`AIDAW ${item.name}`);if(!plugin)throw Error(`Starter ${item.name} scan failed`);
   const info=await knowledge.index({kind:'plugin',plugin_id:plugin.plugin_id,parameters:[]});
   plugins.push({...plugin,parameters:info.parameters,programs:info.programs,package_directory:item.directory,reused:item.reused});
  }
  return plugins;
 });
}
