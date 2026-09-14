import {access,cp,mkdir,readFile,rename,rm,writeFile,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname,join,resolve,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const core=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=dirname(core);
const exists=p=>access(p).then(()=>true,()=>false);
export function installPaths(platform,home,env=process.env){
 if(platform==='darwin')return {directory:'/Applications',name:'AIDAW DECK.app'};
 if(platform==='win32'){if(!env.LOCALAPPDATA||!env.APPDATA)throw Error('LOCALAPPDATA and APPDATA required');return {directory:join(env.LOCALAPPDATA,'Programs'),name:'AIDAW DECK',shortcut:join(env.APPDATA,'Microsoft','Windows','Start Menu','Programs','AIDAW DECK.lnk')};}
 if(platform==='linux')return {directory:join(home,'.local','lib'),name:'aidaw-deck',shortcut:join(env.XDG_DATA_HOME||join(home,'.local','share'),'applications','aidaw-deck.desktop')};
 throw Error('Unsupported desktop OS');
}
export async function replaceApp(source,target,validate=async()=>{}){
 const staged=target+'.install-'+randomUUID(),backup=target+'.previous-'+randomUUID();let moved=false,installed=false;
 try{await cp(source,staged,{recursive:true,verbatimSymlinks:true});await validate(staged);if(await exists(target)){await rename(target,backup);moved=true;}await rename(staged,target);installed=true;}
 catch(error){if(installed)await rm(target,{recursive:true,force:true});if(moved)await rename(backup,target);throw error;}
 finally{await rm(staged,{recursive:true,force:true});}
 if(moved)await rm(backup,{recursive:true,force:true});
}
function run(cmd,args,cwd=core){const r=spawnSync(cmd,args,{cwd,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`${cmd} failed (${r.status})`);}
function tool(name){const r=spawnSync(process.platform==='win32'?'where':'which',[name],{encoding:'utf8'});const path=r.stdout?.trim().split(/\r?\n/)[0];if(r.status!==0||!path)throw Error(`${name} missing; run setup first`);return path;}
export async function installDesktop({dataDir,build=true}={}){
 const platform=process.platform,home=homedir(),paths=installPaths(platform,home);
 const configDir=platform==='darwin'?join(home,'Library','Application Support'):platform==='win32'?process.env.APPDATA:process.env.XDG_CONFIG_HOME||join(home,'.config');
 let preferences={};try{preferences=JSON.parse(await readFile(join(configDir,'AIDAW Player','player-settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const workspace=resolve(dataDir||process.env.AIDAW_HOME||preferences.dataDir||repo);
 if(preferences.dataDir&&resolve(preferences.dataDir)!==workspace)throw Error(`GUI保存先が異なります: ${preferences.dataDir}。同じ --data-dir を指定してください。`);
 await access(join(workspace,'Core','State','workspace.json'));
 const tools={AIDAW_FFMPEG:tool('ffmpeg'),AIDAW_FFPROBE:tool('ffprobe')};
 if(build){const npm=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');if(await exists(npm))run(process.execPath,[npm,'run','build']);else run(process.platform==='win32'?'npm.cmd':'npm',['run','build']);}
 if(platform==='darwin'){try{await access(paths.directory,constants.W_OK);}catch{paths.directory=join(home,'Applications');}}
 await mkdir(paths.directory,{recursive:true});const target=join(paths.directory,paths.name);
 const running=platform==='win32'?spawnSync('tasklist',['/FI','IMAGENAME eq AIDAW DECK.exe','/FO','CSV'],{encoding:'utf8'}):spawnSync('pgrep',['-f',target],{encoding:'utf8'});
 if(platform==='win32'?running.stdout?.includes('AIDAW DECK.exe'):running.status===0)throw Error('AIDAW DECKを終了してからGUI更新を再実行してください。');
 const {packageDesktop}=await import('./package-desktop.mjs');
 const [output]=await packageDesktop({installation:{schema_version:1,dataDir:workspace,tools}});
 const source=platform==='darwin'?join(output,'AIDAW DECK.app'):output;
 const binary=platform==='darwin'?join('Contents','MacOS','AIDAW DECK'):platform==='win32'?'AIDAW DECK.exe':'AIDAW DECK';
 await replaceApp(source,target,p=>access(join(p,binary)));
 if(paths.shortcut){await mkdir(dirname(paths.shortcut),{recursive:true});
  if(platform==='win32'){
   const ps=join(core,'Build','Release','desktop-shortcut.ps1');await writeFile(ps,"$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:AIDAW_SHORTCUT)\n$s.TargetPath=$env:AIDAW_EXECUTABLE\n$s.WorkingDirectory=$env:AIDAW_DIRECTORY\n$s.Save()\n");
   const result=spawnSync('powershell',['-NoProfile','-File',ps],{env:{...process.env,AIDAW_SHORTCUT:paths.shortcut,AIDAW_EXECUTABLE:join(target,binary),AIDAW_DIRECTORY:target},stdio:'inherit'});if(result.status!==0)throw Error('Start Menu shortcut failed');
  }else{const executable=join(target,binary).replace(/([\\"`$])/g,'\\$1');await writeFile(paths.shortcut,`[Desktop Entry]\nType=Application\nName=AIDAW DECK\nExec="${executable}"\nIcon=${join(target,'resources','aidaw-deck.png')}\nTerminal=false\nCategories=AudioVideo;Audio;\n`);await chmod(paths.shortcut,0o755);}
 }
 const receipt={version:JSON.parse(await readFile(join(core,'package.json'))).version,platform,arch:process.arch,path:target,dataDir:workspace,shortcut:paths.shortcut,installed_at:new Date().toISOString()};
 await mkdir(join(workspace,'Core','State','Setup'),{recursive:true});await writeFile(join(workspace,'Core','State','Setup','desktop-install.json'),JSON.stringify(receipt,null,2));
 console.log(`AIDAW DECK installed: ${target}`);return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--data-dir'))throw Error('Usage: node Core/Tools/install-desktop.mjs [--data-dir PATH]');
 await installDesktop({dataDir:args[1]});
}
