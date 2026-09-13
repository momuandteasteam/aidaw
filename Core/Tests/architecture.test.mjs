import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
async function sources(folder){const files=[];for(const item of await readdir(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())files.push(...await sources(path));else if(/\.(ts|mjs|js)$/.test(path))files.push(path);}return files;}
const imports=text=>[...text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(match=>match[1]);
test('portable domain, contracts and controls cannot import runtime or renderer',async()=>{
 for(const folder of ['Core/Source/Domain','Core/Source/Contracts','Core/Source/ControlSurface','Plugins/Controllers'])for(const file of await sources(folder)){
  for(const target of imports(await readFile(file,'utf8'))){
   assert.doesNotMatch(target,/^(node:|electron$)/,file);
   if(target.startsWith('.')){const path=relative(resolve('.'),resolve(file,'..',target));assert.ok(path.startsWith('Core/Source/Domain/')||path.startsWith('Core/Source/Contracts/')||path.startsWith('Core/Source/ControlSurface/')||path.startsWith('Plugins/Controllers/'),`${file} leaks runtime dependency ${target}`);}
  }
 }
});
test('transport adapters use the application contract without concrete service or storage',async()=>{
 for(const folder of ['Core/Source/Adapters/mcp','Core/Source/Adapters/http'])for(const file of await sources(folder))for(const target of imports(await readFile(file,'utf8')))assert.doesNotMatch(target,/service\.js|local-application|adapters\/node|node:fs|engine\.js/,file);
});
test('retired source trees and compiled prototype entrypoints are absent',async()=>{
 for(const path of ['src','native','player','dist/mcp.js','dist/service.js'])await assert.rejects(access(path),{code:'ENOENT'});
});
