import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {join,basename} from 'node:path';import {access,readFile} from 'node:fs/promises';
import type {SeparationPort} from '../../../Contracts/separation.js';import {sha256} from '../workspace/assets.js';
const run=promisify(execFile);
export class DemucsSeparator implements SeparationPort{
 readonly id='demucs';readonly model='htdemucs';constructor(private readonly root:string){}
 async separate({path,outputDirectory,signal}:Parameters<SeparationPort['separate']>[0]){
  const home=join(this.root,'Plugins','Engines','demucs'),python=join(home,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),launcher=join(home,'run-demucs.py');
  try{await access(python);const receipt=JSON.parse(await readFile(join(home,'installation.json'),'utf8'));if(receipt.engine!=='demucs'||receipt.version!=='4.0.1'||receipt.model!==this.model)throw Error('Invalid installation');for(const [file,hash]of Object.entries(receipt.files)){if(!/^[a-zA-Z0-9_.\/-]+$/.test(file)||file.split('/').includes('..'))throw Error('Unsafe model path');if(await sha256(join(home,file))!==hash)throw Error('Model/launcher hash mismatch');}}catch(e){throw Error(`Demucs未導入または破損。node Core/Tools/setup-demucs.mjs を実行してください。${e}`);}
  await run(python,[launcher,'-n',this.model,'--device','cpu','--shifts','1','--float32','-o',outputDirectory,path],{env:{...process.env,TORCH_HOME:join(home,'models'),OMP_NUM_THREADS:'4'},signal,timeout:7200000,maxBuffer:8*1024*1024});
  return ['vocals','drums','bass','other'].map(name=>({name,path:join(outputDirectory,this.model,basename(path).replace(/\.[^.]+$/,''),`${name}.wav`)}));
 }
}
