import {mkdir,mkdtemp,readdir,rename,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),build=join(root,'Build'),output=join(build,'JS');
await mkdir(build,{recursive:true});
const stage=await mkdtemp(join(build,'js-stage-'));
async function files(directory,prefix=''){
 const result=[];try{for(const entry of await readdir(directory,{withFileTypes:true})){const relative=join(prefix,entry.name);if(entry.isDirectory())result.push(...await files(join(directory,entry.name),relative));else result.push(relative);}}catch(error){if(error.code!=='ENOENT')throw error;}return result;
}
try{
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--outDir',stage],{cwd:root,stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>resolve(code??1));
 });
 if(code!==0)process.exitCode=code;
 else{
  const published=new Set(await files(stage));await mkdir(output,{recursive:true});
  // Compile successfully before publishing. Each file replacement is atomic;
  // do not remove the live module tree while another local task is reading it.
  for(const file of published){await mkdir(join(output,file,'..'),{recursive:true});await rename(join(stage,file),join(output,file));}
  for(const file of await files(output))if(!published.has(file))await rm(join(output,file),{force:true});
 }
}finally{await rm(stage,{recursive:true,force:true});}
