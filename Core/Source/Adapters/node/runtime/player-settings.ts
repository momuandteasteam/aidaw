import {join} from 'node:path';
import {atomicJson,locked,readJson} from '../workspace/storage.js';
import {homePaths} from '../workspace/home.js';

export interface PlayerPreferences {projectId?:string;outputDevice?:string;controller?:{profile:string;input:string;mappings:unknown[]};customLayouts?:Record<string,unknown>;skin?:string;encoderAssignments?:Record<string,unknown>}
function object(value:unknown):value is Record<string,any>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
async function readSettings(path:string,fallback:unknown){
 try{const data=await readJson<any>(path);if(data.schema_version!==1||!object(data.value))throw Error(`Unsupported or invalid settings: ${path}`);return data.value;}
 catch(error:any){if(error.code==='ENOENT')return fallback;throw error;}
}
export async function readPlayerPreferences(root:string):Promise<PlayerPreferences>{
 const base=homePaths(root).settings;
 const audio=await readSettings(join(base,'player.json'),{});
 const controller=await readSettings(join(base,'controllers.json'),{profile:'',input:'',mappings:[]});
 const customLayouts=await readSettings(join(base,'layouts.json'),{});
 return {...audio,controller,customLayouts};
}
export async function writePlayerPreferences(root:string,settings:PlayerPreferences){
 const base=homePaths(root).settings;
 if(settings.controller&&(!object(settings.controller)||typeof settings.controller.profile!=='string'||typeof settings.controller.input!=='string'||!Array.isArray(settings.controller.mappings)))throw Error('Invalid controller preferences');
 if(settings.encoderAssignments&&!object(settings.encoderAssignments))throw Error('Invalid encoder assignments');
 if(settings.customLayouts&&!object(settings.customLayouts))throw Error('Invalid button layouts');
 await locked(join(base,'.player-settings.lock'),async()=>{
  await atomicJson(join(base,'player.json'),{schema_version:1,value:{projectId:settings.projectId,outputDevice:settings.outputDevice,skin:settings.skin,...(settings.encoderAssignments?{encoderAssignments:settings.encoderAssignments}:{})}});
  await atomicJson(join(base,'controllers.json'),{schema_version:1,value:settings.controller??{profile:'',input:'',mappings:[]}});
  await atomicJson(join(base,'layouts.json'),{schema_version:1,value:settings.customLayouts??{}});
 });
}
