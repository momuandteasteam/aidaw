import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, unlinkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface HomePaths {
 root:string; core:string; libraries:string; sounds:string; sdks:string; licenses:string; workflows:string; docs:string; skins:string; engines:string; workspaceManifest:string; projects:string; plugins:string; instruments:string; effects:string; engine:string;
 controllers:string; controllerScripts:string; controllerProfiles:string; settings:string; system:string;
 catalog:string; setup:string; state:string; activeContext:string; activeContextLock:string;
 cache:string; logs:string; runtime:string; locks:string; serverLock:string; audioLaneLock:string; audioLaneRecoveryLock:string;
}
/** Resolve from the installed source/build module, never from the terminal working directory. */
export function defaultWorkspaceRoot():string {
 let current=dirname(fileURLToPath(import.meta.url));
 while(dirname(current)!==current){if(basename(current)==='Core')return dirname(current);current=dirname(current);}
 throw new Error('AIDAW runtime must be installed inside Core; set AIDAW_HOME explicitly for an external workspace');
}
/** One canonical layout shared by the GUI, MCP server, setup and engine. No legacy import or path guessing. */
export function homePaths(input:string):HomePaths {
 const root=resolve(input),core=join(root,'Core'),plugins=join(root,'Plugins'),controllers=join(plugins,'Controllers'),libraries=join(root,'Libraries'),state=join(core,'State'),runtime=join(state,'Runtime'),locks=join(runtime,'Locks'),engines=join(plugins,'Engines');
 return {root,core,libraries,sounds:join(libraries,'Sounds'),sdks:join(libraries,'SDKs'),licenses:join(libraries,'Licenses'),workflows:join(root,'Workflows'),docs:join(root,'Docs'),skins:join(plugins,'Skins'),engines,workspaceManifest:join(state,'workspace.json'),projects:join(root,'Projects'),plugins,instruments:join(plugins,'Instruments'),effects:join(plugins,'Effects'),engine:join(engines,'juce'),controllers,controllerScripts:join(controllers,'Scripts'),controllerProfiles:join(controllers,'Profiles'),settings:join(core,'Settings'),system:core,catalog:join(state,'Catalog'),setup:join(state,'Setup'),state,activeContext:join(state,'active-context.json'),activeContextLock:join(locks,'active-context.lock'),cache:join(core,'Cache'),logs:join(core,'Logs'),runtime,locks,serverLock:join(locks,'server.lock'),audioLaneLock:join(locks,'audio-lane.lock'),audioLaneRecoveryLock:join(locks,'audio-lane-recovery.lock')};
}
/** Publish a complete manifest atomically; concurrent initializers cannot observe a partial document. */
export function initializeHome(root:string):HomePaths {
 const paths=homePaths(root);mkdirSync(paths.state,{recursive:true});
 const manifest=paths.workspaceManifest;
 if(!existsSync(manifest)){
  const temporary=join(paths.state,`.workspace-${randomUUID()}.tmp`);
  try{writeFileSync(temporary,JSON.stringify({schema_version:1,architecture:'aidaw-workspace',created_at:new Date().toISOString()},null,2),{flag:'wx'});try{linkSync(temporary,manifest);}catch(e:any){if(e.code!=='EEXIST')throw e;}}finally{if(existsSync(temporary))unlinkSync(temporary);}
 }
 const saved=JSON.parse(readFileSync(manifest,'utf8'));
 if(saved.schema_version!==1||saved.architecture!=='aidaw-workspace')throw new Error('Unsupported AIDAW workspace manifest');
 for(const dir of [paths.sounds,paths.sdks,paths.licenses,paths.workflows,paths.docs,paths.skins,paths.projects,paths.instruments,paths.effects,paths.engine,paths.controllerScripts,paths.controllerProfiles,paths.settings,paths.catalog,paths.setup,paths.state,paths.cache,paths.logs,paths.runtime,paths.locks])mkdirSync(dir,{recursive:true});
 return paths;
}
