import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const core=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repository=resolve(core,'..'),release=join(core,'Build','Release');
export async function stageDesktop(destination=join(release,'desktop-stage')) {
 const stage=resolve(destination),within=relative(release,stage);
 if(!within||within==='..'||within.startsWith('..'+sep)||resolve(release,within)!==stage)throw new Error('Desktop staging must be under Core/Build/Release/');
 await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
 for(const folder of ['Core/Build/JS','Core/Source/Desktop','Core/Source/ControlSurface','Plugins/Controllers','Plugins/Skins','Libraries/Catalog'])await cp(join(repository,folder),join(stage,folder),{recursive:true});
 const pkg=JSON.parse(await readFile(join(core,'package.json'),'utf8'));
 await writeFile(join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,license:pkg.license,type:'module',main:'Core/Source/Desktop/main.mjs',dependencies:pkg.dependencies},null,2)+'\n');
 const modules=execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ls','--omit=dev','--all','--parseable'],{cwd:core,encoding:'utf8'}).trim().split('\n').filter(path=>path!==core);
 for(const source of modules){const rel=relative(core,source);if(!rel.startsWith('node_modules'+sep))throw new Error('Dependency outside package root: '+rel);await cp(source,join(stage,rel),{recursive:true});}
 await cp(join(repository,'LICENSE'),join(stage,'LICENSE'));
 return stage;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const stage=await stageDesktop();
 if(!process.argv.includes('--stage-only')){
  const {default:packager}=await import('@electron/packager');const windows=process.argv.includes('--win');
  await packager({dir:stage,name:'AIDAW Player',platform:windows?'win32':'darwin',arch:windows?'x64':'arm64',appBundleId:'com.momuandteasteam.aidaw.player',out:release,overwrite:true,prune:false,extraResource:[join(core,'Build','Native','bin',windows?'aidaw-engine.exe':'aidaw-engine'),join(core,'Build','Native','starter-assets')]});
 }
 console.log('Desktop distribution staged without Projects or development sources.');
}
