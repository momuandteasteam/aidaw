import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const core=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repository=resolve(core,'..'),release=join(core,'Build','Release');
export async function stageDesktop(destination=join(release,'desktop-stage')) {
 const stage=resolve(destination),within=relative(release,stage);
 if(!within||within==='..'||within.startsWith('..'+sep)||resolve(release,within)!==stage)throw new Error('Desktop staging must be under Core/Build/Release/');
 await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
 for(const folder of ['Core/Build/JS','Core/Source/Desktop','Core/Source/ControlSurface','Plugins/Controllers','Plugins/Skins','Libraries/Catalog','Workflows/Templates/EffectChains'])await cp(join(repository,folder),join(stage,folder),{recursive:true});
 const pkg=JSON.parse(await readFile(join(core,'package.json'),'utf8'));
 await writeFile(join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,license:pkg.license,type:'module',main:'Core/Source/Desktop/main.mjs',dependencies:pkg.dependencies},null,2)+'\n');
 const modules=execFileSync(process.platform==='win32'?process.execPath:'npm',[...(process.platform==='win32'?[join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')]:[]),'ls','--omit=dev','--all','--parseable'],{cwd:core,encoding:'utf8'}).trim().split('\n').filter(path=>path!==core);
 for(const source of modules){const rel=relative(core,source);if(!rel.startsWith('node_modules'+sep))throw new Error('Dependency outside package root: '+rel);await cp(source,join(stage,rel),{recursive:true});}
 await cp(join(repository,'LICENSE'),join(stage,'LICENSE'));
 return stage;
}
export async function packageDesktop({platform=process.platform,arch=process.arch,installation}={}){
 const stage=await stageDesktop();
 if(installation)await writeFile(join(stage,'desktop-install.json'),JSON.stringify(installation,null,2));
 const {packager}=await import('@electron/packager');
 const icon=join(core,'Source','Desktop','assets','aidaw-deck'+(platform==='darwin'?'.icns':platform==='win32'?'.ico':'.png'));
 return packager({dir:stage,name:'AIDAW DECK',platform,arch,icon,extraResource:[join(core,'Source','Desktop','assets','aidaw-deck.png')],appBundleId:'com.momuandteasteam.aidaw.player',out:release,overwrite:true,prune:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--stage-only'))await stageDesktop();
 else await packageDesktop({platform:process.argv.includes('--win')?'win32':process.platform,arch:process.argv.includes('--win')?'x64':process.arch});
 console.log('Desktop distribution staged without Projects or development sources.');
}
