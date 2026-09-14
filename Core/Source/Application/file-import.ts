import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {join,extname,basename} from 'node:path';
import {ingest,sha256} from '../Adapters/node/workspace/assets.js';
import type {Service} from './service.js';
const run=promisify(execFile);
export async function importFile(service:Service,project:string,path:string){
 const extension=extname(path).toLowerCase();
 if(['.png','.jpg','.jpeg'].includes(extension))return ingest(service,project,path,'artwork');
 if(!['.wav','.wave','.aif','.aiff','.flac','.mp3','.m4a','.aac','.ogg','.opus'].includes(extension))throw Error('Unsupported media file');
 await service.readDocument(project);const root=service.dir(project);await mkdir(join(root,'temp'),{recursive:true});const temp=await mkdtemp(join(root,'temp','import-'));
 try{
  const raw=join(temp,'input'+extension);await copyFile(path,raw);const hash=await sha256(raw),output=join(temp,'converted',basename(path,extension)+'.wav');await mkdir(join(temp,'converted'));
  await run(process.env.AIDAW_FFMPEG??'ffmpeg',['-v','error','-nostdin','-y','-i',raw,'-vn','-ar','48000','-ac','2','-c:a','pcm_f32le',output],{timeout:7200000,maxBuffer:1024*1024});
  const original=join(root,'assets','originals',hash+extension);await mkdir(join(root,'assets','originals'),{recursive:true});await copyFile(raw,original);
  return {...await ingest(service,project,output,'source'),original_path:original};
 }finally{await rm(temp,{recursive:true,force:true});}
}
