import {access,cp,mkdir,readFile,readdir,readlink,lstat,rename,rm,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDesktop} from './package-desktop.mjs';
import {installStarter} from './setup/starter.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),core=join(repo,'Core');
const names=['GM','EQ','Limiter','Reverb','Imager','BassMono','Gain','Enhancer'];
export async function hashFile(path){const hash=createHash('sha256');for await(const b of createReadStream(path))hash.update(b);return hash.digest('hex');}
export async function inventory(root){
 const files={};async function walk(dir,prefix=''){
  for(const name of (await readdir(dir)).sort()){
   const path=join(dir,name),key=prefix+name,info=await lstat(path);
   if(info.isSymbolicLink()){
    const target=await readlink(path),rel=relative(root,resolve(dir,target));
    if(rel.startsWith('..')||target.startsWith('/'))throw Error('Distribution symlink escapes root: '+key);
    files[key]={symlink:target};
   }else if(info.isDirectory())await walk(path,key+'/');
   else if(info.isFile())files[key]={sha256:await hashFile(path),bytes:info.size};
   else throw Error('Unsupported distribution file: '+key);
  }
 }await walk(root);return files;
}
export async function verifyNative(path,platform,arch){
 const data=await readFile(path);
 if(platform==='darwin'){
  if(data.length<8||data.readUInt32LE(0)!==0xfeedfacf||data.readUInt32LE(4)!==(arch==='arm64'?0x100000c:0x1000007))throw Error('Wrong macOS native architecture: '+path);
 }else if(platform==='win32'){
  const offset=data.length>=64?data.readUInt32LE(0x3c):0;
  if(data.toString('ascii',0,2)!=='MZ'||offset<64||offset+6>data.length||data.readUInt32LE(offset)!==0x4550||data.readUInt16LE(offset+4)!==0x8664||arch!=='x64')throw Error('Wrong Windows native architecture: '+path);
 }else throw Error('Distribution target must be darwin or win32');
}
function run(cmd,args){return new Promise((accept,reject)=>{const p=spawn(cmd,args,{cwd:repo,stdio:'inherit',shell:false});p.on('error',reject);p.on('exit',code=>code===0?accept():reject(Error(`${cmd} exited ${code}`)));});}
export async function buildDistribution({platform=process.platform,arch=process.arch}={}){
 if(platform!==process.platform||arch!==process.arch||!['darwin','win32'].includes(platform))throw Error('Build the complete distribution on its target OS/architecture');
 const version=JSON.parse(await readFile(join(core,'package.json'),'utf8')).version;
 const native=join(core,'Build/Native'),engine='aidaw-engine'+(platform==='win32'?'.exe':'');
 await verifyNative(join(native,'bin',engine),platform,arch);
 for(const name of names){const bundle=join(native,`starter/aidaw-starter-${name.toLowerCase()}_artefacts/Release/VST3/AIDAW ${name}.vst3`);
  await verifyNative(join(bundle,'Contents',platform==='darwin'?'MacOS':'x86_64-win',`AIDAW ${name}`+(platform==='win32'?'.vst3':'')),platform,arch);
 }
 await installStarter(native);
 const [desktop]=await packageDesktop({platform,arch});
 const release=join(core,'Build/Release'),label=`AIDAW-${version}-${platform}-${arch}`,stage=join(release,label+'.stage'),destination=join(release,label);
 await rm(stage,{recursive:true,force:true});await mkdir(join(stage,'Native/bin'),{recursive:true});
 try{
  await cp(platform==='darwin'?join(desktop,'AIDAW DECK.app'):desktop,join(stage,'Desktop',platform==='darwin'?'AIDAW DECK.app':'AIDAW DECK'),{recursive:true,verbatimSymlinks:true});
  await cp(join(native,'bin',engine),join(stage,'Native/bin',engine));
  for(const name of names){const rel=`starter/aidaw-starter-${name.toLowerCase()}_artefacts/Release/VST3/AIDAW ${name}.vst3`;await cp(join(native,rel),join(stage,'Native',rel),{recursive:true,verbatimSymlinks:true});}
  await cp(join(native,'starter-assets'),join(stage,'Native/starter-assets'),{recursive:true});
  for(const name of ['LICENSE','NOTICE'])await cp(join(repo,name),join(stage,name));
  await cp(join(repo,'Libraries/Licenses'),join(stage,'Notices'),{recursive:true});
  await cp(join(native,'starter-source/tsf.h'),join(stage,'Notices/TinySoundFont.h'));
  const juce=join(native,'_deps/juce-src');
  for(const entry of await readdir(juce))if(/^LICENSE/i.test(entry))await cp(join(juce,entry),join(stage,'Notices','JUCE-'+entry));
  await writeFile(join(stage,'README.txt'),`AIDAW ${version} (${platform} ${arch})\n\nDevelopment distribution; not signed/notarized by a release identity.\nDesktop: prebuilt AIDAW DECK. Native: Audio Engine, GM and seven effects.\nNo user projects, credentials or machine settings are included.\nKeep Native/starter-assets with the plugins. These artifacts are for deployment into an AIDAW home; the current source setup does not yet consume this ZIP automatically.\nNode/FFmpeg, AI client configuration and separation dependencies are separate.\nSource: https://github.com/momuandteasteam/aidaw\nDo not treat an untested OS as tested.\n`);
  const manifest={schema_version:1,version,platform,arch,source_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),source_modified:!!execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),signed:false,files:await inventory(stage)};
  await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const actual=await inventory(stage);delete actual['manifest.json'];if(JSON.stringify(actual)!==JSON.stringify(manifest.files))throw Error('Distribution contents changed during verification');
  await rm(destination,{recursive:true,force:true});await rename(stage,destination);
  const zip=destination+'.zip',pending=zip+'.tmp';await rm(pending,{force:true});
  if(platform==='darwin')await run('/usr/bin/ditto',['-c','-k','--keepParent',destination,pending]);
  else await run('python',[join(core,'Tools/zip-distribution.py'),destination,pending]);
  await rename(pending,zip);
  await writeFile(zip+'.sha256',`${await hashFile(zip)}  ${label}.zip\n`);
  console.log(JSON.stringify({zip,manifest:join(destination,'manifest.json'),version,platform,arch},null,2));return zip;
 }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildDistribution();
