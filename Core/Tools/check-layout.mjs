import {readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const workspaceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const directories=['Core','Projects','Plugins','Libraries','Workflows','Docs'];
const files=['README.md','AGENTS.md','CLAUDE.md','LICENSE','NOTICE'];
export async function checkLayout(root=workspaceRoot){
 const errors=[];
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(['.git','.github','.agents','.codex','.claude','.gitignore','.mcp.json','.DS_Store','.env'].includes(entry.name)||entry.name.startsWith('.env.'))continue;
  if(!(entry.isDirectory()?directories:files).includes(entry.name))errors.push(`Unexpected root entry: ${entry.name}`);
 }
 for(const [folder,allowed] of Object.entries({
  '.agents':['rules'],
  'Core/Source':['Application','Domain','Contracts','Adapters','Desktop','Audio','ControlSurface','Server','CLI','StarterPlugins'],
  Plugins:['Instruments','Effects','Controllers','Skins','Engines'],
  Workflows:['Composition','Mastering','Development','Templates'],
  Docs:['User','Architecture','Contracts','Development','Assets'],
  Libraries:['Sounds','SDKs','Licenses','Catalog']
 })){
  try{for(const entry of await readdir(join(root,folder),{withFileTypes:true}))if(!entry.name.startsWith('.')&&entry.isDirectory()&&!allowed.includes(entry.name))errors.push(`Unexpected directory: ${folder}/${entry.name}`);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(errors.length)throw new Error(errors.join('\n')+'\nFollow Docs/Architecture/DIRECTORIES.md; do not add a fallback tree.');
 return {directories};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){await checkLayout();console.log('Directory contract passed.');}
