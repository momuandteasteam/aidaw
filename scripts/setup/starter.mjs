// Pinned, bounded and atomic downloads. No platform-specific archive tool required.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,access} from 'node:fs/promises';
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
export async function installStarter(build,{fetcher=fetch}={}){
 const dest=join(build,'starter-assets');await mkdir(dest,{recursive:true});
 const bank=join(dest,'FluidR3_GM.sf2');
 try{if(sha(await readFile(bank))===bankHash){await access(join(dest,'FluidR3-LICENSE.txt'));await access(join(dest,'FluidR3-README.txt'));return {bank,sha256:bankHash,reused:true};}}catch{}
 console.log('[setup] Downloading FluidR3 GM (129 MiB, MIT); verifying SHA-256.');
 const response=await fetcher(url,{signal:AbortSignal.timeout(300000)});if(!response.ok||!response.body)throw Error(`Starter download failed: HTTP ${response.status}`);
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>140*1024*1024)throw Error('Starter download exceeds size limit');chunks.push(chunk);}
 const files=unpackBank(Buffer.concat(chunks));
 // Publish the bank last, only after its mandatory notices have been saved.
 for(const name of ['FluidR3-LICENSE.txt','FluidR3-README.txt','FluidR3_GM.sf2']){
  const tmp=join(dest,`.${randomUUID()}.tmp`);try{await writeFile(tmp,files[name],{flag:'wx'});await rename(tmp,join(dest,name));}finally{await rm(tmp,{force:true});}
 }
 return {bank,sha256:bankHash,reused:false};
}
export async function registerStarter(service,build){
 const plugins=[];
 const {Knowledge}=await import('../../dist/knowledge.js');const knowledge=new Knowledge(service);
 for(const name of ['GM','EQ','Limiter','Reverb']){
  const location=join(build,`aidaw-starter-${name.toLowerCase()}_artefacts`,'Release','VST3',`AIDAW ${name}.vst3`);
  const scan=await service.scan('VST3',location);
  const plugin=scan.plugins.find(p=>p.name===`AIDAW ${name}`);if(!plugin)throw Error(`Starter ${name} scan failed`);
  const info=await knowledge.index({kind:'plugin',plugin_id:plugin.plugin_id,parameters:[]});
  plugins.push({...plugin,parameters:info.parameters,programs:info.programs});
 }
 return plugins;
}
