import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {access,readFile} from 'node:fs/promises';
import type {SeparationPort} from '../../../Contracts/separation.js';
import {sha256} from '../workspace/assets.js';
const run=promisify(execFile);
export class SpleeterSeparator implements SeparationPort {
 readonly id='spleeter';readonly model='4stems-16kHz';
 constructor(private readonly root:string){}
 async separate({path,outputDirectory,signal}:Parameters<SeparationPort['separate']>[0]){
  const home=join(this.root,'Plugins','Engines','spleeter'),python=join(home,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),worker=join(home,'worker.py');
  try{await access(python);const receipt=JSON.parse(await readFile(join(home,'installation.json'),'utf8'));if(receipt.engine!=='spleeter'||receipt.version!=='2.4.2')throw Error('Invalid installation');for(const [file,hash]of Object.entries(receipt.files)){if(!/^[a-zA-Z0-9_.\/-]+$/.test(file)||file.split('/').includes('..'))throw Error('Unsafe model path');if(await sha256(join(home,file))!==hash)throw Error('Model/worker hash mismatch');}}catch(e){throw Error(`Spleeter is not installed or invalid. Run node Core/Tools/setup-separation.mjs. ${e}`);}
  await run(python,[worker,path,outputDirectory],{env:{...process.env,MODEL_PATH:join(home,'models'),TF_CPP_MIN_LOG_LEVEL:'2'},signal,timeout:7200000,maxBuffer:8*1024*1024});
  return ['vocals','drums','bass','other'].map(name=>({name,path:join(outputDirectory,`${name}.wav`)}));
 }
}
