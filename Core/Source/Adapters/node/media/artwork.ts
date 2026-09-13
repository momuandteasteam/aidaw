import {readFile,stat} from 'node:fs/promises';
import {manifest,verifyAsset} from '../workspace/assets.js';
import type {Service} from '../../../Application/service.js';
/** Read collected artwork only; missing or damaged images never block playback. */
export async function projectArtwork(service:Service,projectId:string){
 const dir=service.dir(projectId);await service.readDocument(projectId);
 try{
  const asset=(await manifest(dir)).assets.filter(a=>a.role==='artwork').at(-1);
  if(!asset)return {data_url:null};
  const path=await verifyAsset(dir,asset);
  if((await stat(path)).size>20*1024*1024)return {data_url:null};
  const bytes=await readFile(path);
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  return {data_url:png||jpeg?`data:image/${png?'png':'jpeg'};base64,${bytes.toString('base64')}`:null};
 }catch{return {data_url:null};}
}
