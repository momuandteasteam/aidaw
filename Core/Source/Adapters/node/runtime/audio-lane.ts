import { homePaths } from '../workspace/home.js';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Coordinate complete audio operations across Player and MCP processes on one data root. */
export async function acquireAudioLane(root:string,signal?:AbortSignal){
 const paths=homePaths(root),lock=paths.audioLaneLock,base=dirname(lock);await mkdir(base,{recursive:true});
 const identity=randomUUID();let missingOwnerSince=0;
 for(;;){
  if(signal?.aborted)throw new Error('Audio operation cancelled while waiting for the shared lane');
  try{
   await mkdir(lock);
   try{await writeFile(join(lock,'owner.pending'),JSON.stringify({pid:process.pid,identity,created_at:new Date().toISOString()}),{flag:'wx'});await rename(join(lock,'owner.pending'),join(lock,'owner.json'));}catch(error){await rm(lock,{recursive:true,force:true});throw error;}
   return async()=>{try{const owner=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'));if(owner.identity===identity)await rm(lock,{recursive:true,force:true});}catch(e:any){if(e.code!=='ENOENT')throw e;}};
  }catch(error:any){if(error.code!=='EEXIST')throw error;}
  try{
   const original=await readFile(join(lock,'owner.json'),'utf8'),owner=JSON.parse(original);missingOwnerSince=0;
   if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.identity!=='string')throw new Error('Invalid shared audio lane owner');
   let stopped=false;try{process.kill(owner.pid,0);}catch(e:any){if(e.code==='ESRCH')stopped=true;else if(e.code!=='EPERM')throw e;}
   // A stopped process is verified before recovery; identity is rechecked to avoid releasing a new owner.
   if(stopped){
    const recovery=paths.audioLaneRecoveryLock;let ownsRecovery=false;
    try{await mkdir(recovery);ownsRecovery=true;const current=await readFile(join(lock,'owner.json'),'utf8');if(current===original)await rm(lock,{recursive:true,force:true});}
    catch(e:any){if(!['EEXIST','ENOENT'].includes(e.code))throw e;}
    finally{if(ownsRecovery)await rm(recovery,{recursive:true,force:true});}
    continue;
   }
  }catch(e:any){if(e.code!=='ENOENT')throw e;if(!missingOwnerSince)missingOwnerSince=Date.now();if(Date.now()-missingOwnerSince>10000)throw new Error('Shared audio lock has no owner record; verify stopped owner before recovery');}
  await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,50);signal?.addEventListener('abort',done,{once:true});});
 }
}
