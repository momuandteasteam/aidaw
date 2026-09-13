import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rm,stat} from 'node:fs/promises';
import {join,extname,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {ArtifactError,type ArtifactPort} from '../../../Contracts/application-contract.js';
import {contained,sha256} from './assets.js';
import {systemLayout,newJob} from './layout.js';
import {atomicJson} from './storage.js';
import {homePaths} from './home.js';
/** Filesystem policy belongs to this adapter, not to the HTTP transport. */
export function createLocalArtifacts(root:string):ArtifactPort {
 return {
  async upload(filename,body,maxBytes){
   const suffix=extname(filename).toLowerCase();
   if(!['.wav','.mid','.midi','.zip','.aidaw','.jpg','.jpeg','.png','.nksf','.mb2'].includes(suffix))throw new ArtifactError(400,'Unsupported upload extension');
   const dir=join(homePaths(root).state,'Inbox');await systemLayout(dir);
   const job=await newJob(dir,{kind:'remote_upload',filename});let file:string|undefined;
   try{
    file=join(job.path,'artifacts',randomUUID()+suffix);await mkdir(join(job.path,'artifacts'),{recursive:true});let bytes=0;
    const limit=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>maxBytes?new ArtifactError(413,'Upload limit exceeded'):null,chunk);}});
    await pipeline(body,limit,createWriteStream(file,{flags:'wx',mode:0o600}));if(!bytes)throw new ArtifactError(400,'Empty upload');
    const result={job_id:job.id,path:file,bytes,sha256:await sha256(file),next:'Use this SERVER path with asset_import, midi_import or project_open. Upload alone does not validate its format.'};
    await atomicJson(join(job.path,'status.json'),{state:'succeeded',...result});return result;
   }catch(e){if(file)await rm(file,{force:true});await atomicJson(join(job.path,'status.json'),{state:'failed',error:String(e)});throw e;}
  },
  async download(identifier){
   if(!isAbsolute(identifier))throw new ArtifactError(400,'Provide an absolute server output path');
   const rel=relative(root,identifier).split('\\').join('/');let path:string;
   try{path=await contained(root,rel);}catch{throw new ArtifactError(403,'File is outside AIDAW storage');}
   if(!/(?:^|\/)(?:outputs|artifacts|assets)\/|\/state\/frozen\//.test(rel)||!['.wav','.mp3','.flac','.aidaw','.mid','.midi','.zip','.json','.png','.jpg','.jpeg'].includes(extname(path).toLowerCase()))throw new ArtifactError(403,'Only assets and generated artifacts can be downloaded');
   let info;try{info=await stat(path);}catch(e:any){if(e.code==='ENOENT')throw new ArtifactError(404,'Not a file');throw e;}if(!info.isFile())throw new ArtifactError(404,'Not a file');
   const mime:Record<string,string>={'.wav':'audio/wav','.mp3':'audio/mpeg','.mid':'audio/midi','.midi':'audio/midi','.json':'application/json','.zip':'application/zip','.aidaw':'application/zip','.flac':'audio/flac','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
   return {bytes:info.size,contentType:mime[extname(path).toLowerCase()]??'application/octet-stream',body:createReadStream(path)};
  }
 };
}
