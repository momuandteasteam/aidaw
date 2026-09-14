import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,writeFile,readFile,readdir,rm,rename,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {uvPythonEnvironment} from './setup/python-environment.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const demucsTerms={code_license:'MIT',weights_terms:'Provided only for scientific purposes; not covered by the code MIT license.',weights_terms_source:'https://github.com/facebookresearch/demucs/issues/327#issuecomment-1134828611'};
function execute(cmd,args,env){return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{stdio:'inherit',env});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`${cmd} exited ${code}`)));});}
export async function setupDemucs(workspace=process.env.AIDAW_HOME??root){
 const home=join(resolve(workspace),'Plugins/Engines/demucs'),receipt=join(home,'installation.json');await mkdir(home,{recursive:true});await rm(receipt,{force:true});
 console.log(`[Demucs] Code: ${demucsTerms.code_license}. Model weights: ${demucsTerms.weights_terms}\n${demucsTerms.weights_terms_source}`);
 const env=uvPythonEnvironment(workspace,{...process.env,TORCH_HOME:join(home,'models')});
 const python=join(home,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 try{await access(python);}catch{await execute('uv',['venv','--python','3.10',join(home,'venv')],env);}
 await execute('uv',['pip','install','--python',python,'demucs==4.0.1','torch==2.5.1','torchaudio==2.5.1','numpy<2','soundfile==0.13.1'],env);
 const infoPath=join(home,'model-info.json');
 await execute(python,['-c',[
  'import json, sys, importlib.metadata',
  'from demucs.pretrained import get_model, REMOTE_ROOT, _parse_remote_files',
  'import yaml',
  'model = get_model("htdemucs")',
  'assert model.samplerate == 44100 and set(model.sources) == {"drums", "bass", "other", "vocals"}',
  'registry = _parse_remote_files(REMOTE_ROOT / "files.txt")',
  'signatures = yaml.safe_load((REMOTE_ROOT / "htdemucs.yaml").read_text())["models"]',
  'info = {"version":importlib.metadata.version("demucs"),"model":"htdemucs","sample_rate":model.samplerate,"sources":model.sources,"model_urls":[registry[s] for s in signatures]}',
  'assert info["version"] == "4.0.1"',
  'with open(sys.argv[1], "w") as f: json.dump(info, f)',
 ].join('\n'),infoPath],env);
 const info=JSON.parse(await readFile(infoPath,'utf8')),files={};
 async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
 const checkpoints=join(home,'models','hub','checkpoints');
 for(const e of await readdir(checkpoints,{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.th'))files[`models/hub/checkpoints/${e.name}`]=await hashFile(join(checkpoints,e.name));
 if(!Object.keys(files).length)throw Error('No downloaded Demucs checkpoint found');
 // The launcher uses the downloaded cache even when invoked from another directory.
 const launcher=join(home,'run-demucs.py');await writeFile(launcher,'import os, runpy\nfrom pathlib import Path\nos.environ["TORCH_HOME"] = str(Path(__file__).resolve().parent / "models")\nrunpy.run_module("demucs", run_name="__main__")\n');
 files['run-demucs.py']=await hashFile(launcher);
 await writeFile(join(home,'MODEL-TERMS.txt'),`${demucsTerms.weights_terms}\n${demucsTerms.weights_terms_source}\nDownloading at setup does not change these terms.\n`);
 const packages=join(home,'packages.txt');await execute(python,['-c','import importlib.metadata,sys; from pathlib import Path; Path(sys.argv[1]).write_text(chr(10).join(sorted(d.metadata["Name"]+"=="+d.version for d in importlib.metadata.distributions()))+chr(10))',packages],env);
 const result={engine:'demucs',...info,...demucsTerms,source:'https://github.com/facebookresearch/demucs',installed_at:new Date().toISOString(),files};
 const temp=join(home,`${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(result,null,2));await rename(temp,receipt);
 console.log('[Demucs] Installed and HTDemucs checkpoint loaded successfully.');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await setupDemucs();
