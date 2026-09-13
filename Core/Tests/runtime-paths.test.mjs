import test from 'node:test';
import assert from 'node:assert/strict';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {access,readFile,readdir} from 'node:fs/promises';
import {defaultWorkspaceRoot,homePaths} from '../Build/JS/Adapters/node/workspace/home.js';
import {defaultEngineExecutable} from '../Build/JS/Adapters/node/engine/engine-installation.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('workspace and native build resources resolve from Core regardless of current working directory',()=>{
 const before=process.cwd();try{process.chdir(join(root,'Core'));assert.equal(defaultWorkspaceRoot(),root);assert.equal(defaultEngineExecutable(),join(root,'Core','Build','Native','bin',process.platform==='win32'?'aidaw-engine.exe':'aidaw-engine'));assert.equal(homePaths(root).settings,join(root,'Core','Settings'));}finally{process.chdir(before);}
});
test('desktop renderer, controller and skin local module references exist after the source move',async()=>{
 async function check(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await check(path);else if(/\.(?:mjs|js|cjs|html)$/.test(path)){const text=await readFile(path,'utf8');for(const match of text.matchAll(/(?:from\s+|import\s*\(|(?:src|href)=)["']([^"']+)["']/g)){const ref=match[1];if(ref.startsWith('.')||path.endsWith('.html'))await access(resolve(directory,ref));}}}}
 for(const path of ['Core/Source/Desktop','Core/Source/ControlSurface','Plugins/Controllers','Plugins/Skins'])await check(join(root,path));
});
