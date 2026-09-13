import {homePaths} from '../Build/JS/Adapters/node/workspace/home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installEngine,resolveEngineExecutable,resolveEngineSoundfont} from '../Build/JS/Adapters/node/engine/engine-installation.js';
import {Engine} from '../Build/JS/Adapters/node/engine/engine.js';

test('managed engine is immutable, verified and explicit overrides win',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-engine-install-')),saved=process.env.AIDAW_ENGINE;
 delete process.env.AIDAW_ENGINE;
 try{
  const source=join(root,'source');await writeFile(source,'first-engine');
  const pending=new Engine(undefined,{home:root});
  assert.equal(typeof pending.describe,'function');
  assert.throws(()=>resolveEngineExecutable(root),/not installed/);
  assert.equal(resolveEngineExecutable(root,source),source);
  const first=await installEngine(root,source,{version:'1'});assert.equal(resolveEngineExecutable(root),first.path);
  await writeFile(source,'second-engine');const second=await installEngine(root,source,{version:'2'});
  assert.notEqual(first.path,second.path);assert.equal(await readFile(first.path,'utf8'),'first-engine');assert.equal(resolveEngineExecutable(root),second.path);
  await writeFile(second.path,'corrupt');assert.throws(()=>resolveEngineExecutable(root),/integrity/);
  process.env.AIDAW_ENGINE=source;assert.equal(resolveEngineExecutable(root),source);
 }finally{if(saved===undefined)delete process.env.AIDAW_ENGINE;else process.env.AIDAW_ENGINE=saved;await rm(root,{recursive:true,force:true});}
});
test('managed soundfont beats development fallback and rejects incompatible engine metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-engine-meta-')),saved=process.env.AIDAW_SOUNDFONT,engineEnv=process.env.AIDAW_ENGINE;delete process.env.AIDAW_SOUNDFONT;delete process.env.AIDAW_ENGINE;
 try{
  assert.equal(resolveEngineSoundfont(root,join(root,'absent')),undefined);
  const source=join(root,'source-binary');await writeFile(source,'engine');await installEngine(root,source);
  const bank=join(root,'Plugins','Instruments','aidaw-gm','Resources','FluidR3_GM.sf2');await mkdir(join(bank,'..'),{recursive:true});await writeFile(bank,'bank');assert.equal(resolveEngineSoundfont(root,source),bank);
  process.env.AIDAW_SOUNDFONT=source;assert.equal(resolveEngineSoundfont(root,source),source);
  const path=join(homePaths(root).engine,'manifest.json'),m=JSON.parse(await readFile(path,'utf8'));m.arch='incompatible';await writeFile(path,JSON.stringify(m));assert.throws(()=>resolveEngineExecutable(root),/incompatible/);
 }finally{if(saved===undefined)delete process.env.AIDAW_SOUNDFONT;else process.env.AIDAW_SOUNDFONT=saved;if(engineEnv===undefined)delete process.env.AIDAW_ENGINE;else process.env.AIDAW_ENGINE=engineEnv;await rm(root,{recursive:true,force:true});}
});
