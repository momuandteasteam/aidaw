import {spawn} from 'node:child_process';
import {mkdir,copyFile,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {uvPythonEnvironment} from './setup/python-environment.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),workspace=process.env.AIDAW_HOME??root,home=join(workspace,'Plugins/Engines/spleeter'),uvEnv=uvPythonEnvironment(workspace);
const run=(cmd,args,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{stdio:'inherit',env});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${cmd} exited ${code}`)));});
await mkdir(home,{recursive:true});
await run('uv',['venv','--python','3.10','--allow-existing',join(home,'venv')],uvEnv);
const python=join(home,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const tf=process.platform==='darwin'&&process.arch==='arm64'?'tensorflow-macos==2.12.0':'tensorflow==2.12.1';
await run('uv',['pip','install','--python',python,tf,'numpy<1.24','pandas<2','norbert==0.2.1','ffmpeg-python==0.2.0','httpx[http2]==0.19.0','typer==0.3.2','soundfile==0.13.1'],uvEnv);
await run('uv',['pip','install','--python',python,'--no-deps','spleeter==2.4.2'],uvEnv);
await run(python,['-c',"from spleeter.model.provider import ModelProvider; ModelProvider.default().get('4stems')"],{...uvEnv,MODEL_PATH:join(home,'models')});
await copyFile(join(root,'Core/Source/Adapters/node/media/spleeter-worker.py'),join(home,'worker.py'));
await copyFile(join(root,'Libraries/Licenses/Spleeter-LICENSE.txt'),join(home,'LICENSE.txt'));
const files={};async function walk(dir,prefix){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name),rel=`${prefix}/${e.name}`;if(e.isDirectory())await walk(path,rel);else if(e.isFile())files[rel]=createHash('sha256').update(await readFile(path)).digest('hex');}}
await walk(join(home,'models'),'models');files['worker.py']=createHash('sha256').update(await readFile(join(home,'worker.py'))).digest('hex');
await writeFile(join(home,'installation.json'),JSON.stringify({engine:'spleeter',version:'2.4.2',model:'4stems-16kHz',license:'MIT',source:'https://github.com/deezer/spleeter',model_source:'https://github.com/deezer/spleeter/releases/tag/v1.4.0',installed_at:new Date().toISOString(),files},null,2));
console.log('Spleeter 4 stems installed. Model and worker hashes recorded.');

// Demucs code and checkpoints are acquired locally, never bundled in source.
const {setupDemucs}=await import('./setup-demucs.mjs');
await setupDemucs(workspace);
