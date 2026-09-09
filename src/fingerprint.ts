import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './assets.js';
const components=new Map<string,string>();
async function componentPath(identifier:string){
 if(components.has(identifier))return components.get(identifier)!;
 const codes=identifier.slice(identifier.lastIndexOf('/')+1).split(',');if(codes.length!==3)throw new Error('Unknown AudioUnit identifier');
 for(const root of ['/Library/Audio/Plug-Ins/Components',join(homedir(),'Library/Audio/Plug-Ins/Components'),'/System/Library/Components']){
  const names=await readdir(root).catch(()=>[]);for(const name of names.filter(n=>n.endsWith('.component'))){const bundle=join(root,name);
   try{const output=await promisify(execFile)('/usr/bin/plutil',['-convert','json','-o','-',join(bundle,'Contents','Info.plist')]);const plist=JSON.parse(output.stdout);
    if(plist.AudioComponents?.some((c:any)=>c.type===codes[0]&&c.subtype===codes[1]&&c.manufacturer===codes[2])){components.set(identifier,bundle);return bundle;}
   }catch{}
  }
 }
 throw new Error('AudioUnit binary location not resolved');
}
export async function binaryFingerprint(path:string):Promise<string>{
 if(path.startsWith('AudioUnit:'))path=await componentPath(path);
 const hash=createHash('sha256');let total=0;
 async function visit(path:string,name:string){const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Cannot certify symlinked plugin contents');if(info.isDirectory()){for(const entry of (await readdir(path)).sort())await visit(join(path,entry),`${name}/${entry}`);}else{total+=info.size;if(total>1024*1024*1024)throw new Error('Plugin fingerprint size limit');hash.update(name);hash.update(await sha256(path));}}
 await visit(path,'');return hash.digest('hex');
}
