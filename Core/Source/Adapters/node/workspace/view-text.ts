import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function atomicText(path:string,text:string){
 try{if(await readFile(path,'utf8')===text)return;}catch(e:any){if(e.code!=='ENOENT')throw e;}
 await mkdir(dirname(path),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,text,{flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
