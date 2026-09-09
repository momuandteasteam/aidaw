import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {layout} from './layout.js';
/** A running server owns one data root. Stale ownership requires explicit recovery. */
export async function acquireServerLease(root:string){
 const base=join(root,'Server.aidaw');await layout(base);const lock=join(base,'temp','server.lock'),identity=randomUUID();
 try{await mkdir(lock);}catch(e:any){if(e.code==='EEXIST')throw new Error('An AIDAW server already owns this data directory, or a stale server.lock remains. Connect to the existing HTTP server; remove a stale lock only after verifying the old server stopped.');throw e;}
 try{await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,identity,created_at:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(e){await rm(lock,{recursive:true,force:true});throw e;}
 return async()=>{try{const owner=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'));if(owner.identity===identity)await rm(lock,{recursive:true,force:true});}catch(e:any){if(e.code!=='ENOENT')throw e;}};
}
