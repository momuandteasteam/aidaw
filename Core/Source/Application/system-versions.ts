import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {releaseVersion} from '../Contracts/release.js';
import type {Service} from './service.js';
type Category='core'|'builtin'|'technology';
type Component={category:Category;id:string;name:string;version:string|null;status:'running'|'installed'|'unknown'};
export async function systemVersions(service:Service){
 const components:Component[]=[{category:'core',id:'api',name:'AIDAW API',version:releaseVersion,status:'running'},{category:'core',id:'mcp',name:'AIDAW MCP Bridge',version:releaseVersion,status:'installed'},{category:'core',id:'core',name:'AIDAW Core',version:releaseVersion,status:'running'},{category:'technology',id:'node',name:'Node.js',version:process.versions.node,status:'running'}];
 if(process.versions.electron)components.push({category:'core',id:'gui',name:'AIDAW DECK',version:releaseVersion,status:'running'},{category:'technology',id:'electron',name:'Electron',version:process.versions.electron,status:'running'});
 const add=async(id:string,name:string,path:string,category:Category)=>{try{const data=JSON.parse(await readFile(path,'utf8'));if(typeof data.version!=='string'||!data.version.trim())throw Error('Missing version');components.push({category,id,name,version:data.version,status:'installed'});}catch{components.push({category,id,name,version:null,status:'unknown'});}};
 await add('engine:juce','AIDAW Audio Engine',join(service.root,'Plugins','Engines','juce','manifest.json'),'core');
 await add('engine:demucs','Demucs',join(service.root,'Plugins','Engines','demucs','installation.json'),'technology');
 await add('engine:spleeter','Spleeter',join(service.root,'Plugins','Engines','spleeter','installation.json'),'technology');
 for(const category of ['Instruments','Effects']){
  const root=join(service.root,'Plugins',category);let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{continue;}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name)))if(entry.isDirectory())await add(`${category}:${entry.name}`,entry.name.startsWith('aidaw-')?'AIDAW '+entry.name.slice(6).replace(/(^|[- ])\w/g,s=>s.replace('-',' ').toUpperCase()):entry.name,join(root,entry.name,'manifest.json'),entry.name.startsWith('aidaw-')?'builtin':'technology');
 }
 return {schema_version:1,version:releaseVersion,components};
}
