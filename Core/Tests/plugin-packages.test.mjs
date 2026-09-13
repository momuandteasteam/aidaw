import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readPluginPackage,discoverManagedPlugins} from '../Build/JS/Adapters/node/engine/plugin-packages.js';
import {registerStarter} from '../Tools/setup/starter.mjs';
import {fixture} from './helpers.mjs';

test('managed packages reject incompatible manifests and resource escapes without loading native code',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-package-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=join(root,'Plugins','Effects','custom');await mkdir(join(dir,'Test.vst3'),{recursive:true});
 const manifest={schema_version:1,package_id:'custom',version:'1',category:'effect',format:'VST3',entry:'Test.vst3',platform:process.platform,arch:process.arch};
 const save=async m=>writeFile(join(dir,'manifest.json'),JSON.stringify(m));await save(manifest);
 assert.equal((await readPluginPackage(dir)).entry,await realpath(join(dir,'Test.vst3')));
 assert.deepEqual((await discoverManagedPlugins(root)).candidates,[await realpath(join(dir,'Test.vst3'))]);
 await save({...manifest,entry:'../outside.vst3'});await assert.rejects(readPluginPackage(dir),/relative path/);
 await save({...manifest,schema_version:900});await assert.rejects(readPluginPackage(dir),/manifest/);
 await save({...manifest,resources:{bank:{path:'bad',sha256:'bad'}}});await assert.rejects(readPluginPackage(dir),/checksum/);
 await writeFile(join(dir,'resource.bin'),'corrupt');await save({...manifest,resources:{bank:{path:'resource.bin',sha256:'0'.repeat(64)}}});await assert.rejects(readPluginPackage(dir),/checksum mismatch/);
 await mkdir(join(root,'outside.vst3'));await symlink(join(root,'outside.vst3'),join(dir,'escape.vst3'),'dir');
 await save({...manifest,entry:'escape.vst3'});await assert.rejects(readPluginPackage(dir),/escapes/);
 const found=await discoverManagedPlugins(root);assert.equal(found.candidates.length,0);assert.equal(found.errors.length,1);
});

test('standard packages relocate all VST3s, reuse complete installs and preserve processor IDs and rendered audio',async t=>{
 const {api,service}=await fixture(t),build=resolve('Core/Build/Native');
 const previous=[];
 for(const name of ['GM','EQ','Limiter','Reverb']){
  const scan=await api('catalog_scan',{format:'VST3',location:join(build,`starter/aidaw-starter-${name.toLowerCase()}_artefacts/Release/VST3/AIDAW ${name}.vst3`)});previous.push(scan.plugins[0]);
 }
 await api('project_create',{project_id:'package-test',name:'Package migration',bpm:120,length_ticks:960});
 await api('project_apply',{project_id:'package-test',base_revision:0,request_id:'seed',operations:[{op:'add_track',track:{id:'piano',name:'Piano',instrument:{kind:'plugin',plugin_id:previous[0].plugin_id},effects:previous.slice(1).map(p=>({kind:'plugin',plugin_id:p.plugin_id})),notes:[{id:'note',tick:0,duration:480,pitch:60,velocity:90}]}}]});
 const render=async()=>{const job=await api('render_start',{project_id:'package-test',tail_seconds:1});const result=await service.wait(job.job_id);assert.equal(result.state,'succeeded',result.error);return result;};
 const before=await render();const installed=await registerStarter(service,build);
 assert.deepEqual(installed.map(p=>p.plugin_id),previous.map(p=>p.plugin_id));assert.ok(installed.every(p=>p.location.startsWith(join(service.root,'Plugins'))));
 const after=await render();assert.equal(after.sha256,before.sha256);
 const again=await registerStarter(service,build);assert.ok(again.every(p=>p.reused));
 const found=await service.discover('VST3');for(const p of installed)assert.ok(found.candidates.includes(await realpath(p.location)));
 // A newly dropped complete VST3 bundle is discovered without compiling the engine.
 const {cp}=await import('node:fs/promises');const extra=join(service.root,'Plugins','Effects','Added.vst3');await cp(installed[1].location,extra,{recursive:true});
 assert.ok((await service.discover('VST3')).candidates.includes(await realpath(extra)));
 const scanned=await service.scan('VST3',extra);assert.equal(scanned.plugins[0].plugin_id,previous[1].plugin_id);
 const gm=await readPluginPackage(installed[0].package_directory);assert.equal(gm.manifest.resources.soundfont.path,'Resources/FluidR3_GM.sf2');
});
