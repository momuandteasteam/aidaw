import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homePaths, initializeHome } from '../Build/JS/Adapters/node/workspace/home.js';
import { Service } from '../Build/JS/Application/service.js';
import { saveProject, importBundle } from '../Build/JS/Adapters/node/workspace/package.js';
import { acquireAudioLane } from '../Build/JS/Adapters/node/runtime/audio-lane.js';
import { acquireServerLease } from '../Build/JS/Adapters/node/runtime/server-lease.js';
import { Knowledge } from '../Build/JS/Application/knowledge.js';
async function root(t) {const dir=await mkdtemp(join(tmpdir(),'aidaw-home-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const project={project_id:'song',name:'Song',bpm:120,length_ticks:3840,meter:[4,4],kind:'composition'};
test('new home creates canonical data areas and archives/selection round trip without system fake projects',async t=>{
 const dir=await root(t),service=new Service(dir);t.after(()=>service.close());
 assert.equal(service.paths.projects,join(dir,'Projects'));
 assert.equal(service.paths.engine,join(dir,'Plugins','Engines','juce'));
 assert.equal(service.paths.sounds,join(dir,'Libraries','Sounds'));
 assert.equal(service.paths.settings,join(dir,'Core','Settings'));
 assert.equal(service.paths.controllers,join(dir,'Plugins','Controllers'));
 assert.equal(service.paths.skins,join(dir,'Plugins','Skins'));
 assert.ok(!(await readdir(dir)).includes('Home'));
 for(const name of ['Core','Projects','Plugins','Libraries','Workflows','Docs'])assert.ok((await readdir(dir)).includes(name));
 await service.create(project);await service.selectActiveContext({project_id:'song'});
 const second=new Service(dir);t.after(()=>second.close());assert.equal((await second.activeContext()).project_id,'song');
 const archive=await saveProject(service,'song');assert.match(archive.output,/\.aidaw\.zip$/);await importBundle(second,archive.output,'copy');
 assert.deepEqual((await second.listProjects()).map(p=>p.project_id).sort(),['copy','song']);
 const knowledge=new Knowledge(service);await knowledge.put('test',{evidence:'persistent'});assert.equal((await knowledge.search('persistent')).length,1);
 assert.ok(!(await readdir(join(service.paths.catalog,'state'))).includes('composition'));
 assert.ok(!(await readdir(dir)).includes('projects'));
});
test('home paths are canonical and unrelated feasibility data is never imported or deleted',async t=>{
 const dir=await root(t);await mkdir(join(dir,'PluginLibrary.aidaw'),{recursive:true});await writeFile(join(dir,'PluginLibrary.aidaw','original'),'unchanged');
 const paths=initializeHome(dir);assert.equal(paths.catalog,join(dir,'Core','State','Catalog'));
 assert.equal(await readFile(join(dir,'PluginLibrary.aidaw','original'),'utf8'),'unchanged');
 assert.equal((await readdir(paths.projects)).length,0);
 assert.equal(homePaths(dir).activeContext,join(dir,'Core','State','active-context.json'));
});
test('unsupported manifests are rejected and initialization preserves the home identity',async t=>{
 const dir=await root(t);initializeHome(dir);const manifest=await readFile(homePaths(dir).workspaceManifest,'utf8');initializeHome(dir);assert.equal(await readFile(homePaths(dir).workspaceManifest,'utf8'),manifest);
 await writeFile(homePaths(dir).workspaceManifest,JSON.stringify({schema_version:99,architecture:'aidaw-workspace'}));assert.throws(()=>initializeHome(dir),/Unsupported/);
});
test('two clients share one canonical audio and server lock namespace',async t=>{
 const dir=await root(t),paths=initializeHome(dir);assert.equal(paths.audioLaneLock,join(dir,'Core','State','Runtime','Locks','audio-lane.lock'));
 await mkdir(paths.audioLaneLock,{recursive:true});await writeFile(join(paths.audioLaneLock,'owner.json'),JSON.stringify({pid:process.pid,identity:'other-client'}));
 const abort=new AbortController();setTimeout(()=>abort.abort(),75);await assert.rejects(acquireAudioLane(dir,abort.signal),/cancelled/);
 assert.equal(JSON.parse(await readFile(join(paths.audioLaneLock,'owner.json'),'utf8')).identity,'other-client');
 await rm(paths.audioLaneLock,{recursive:true});const release=await acquireAudioLane(dir);await release();
 const releaseServer=await acquireServerLease(dir);await assert.rejects(acquireServerLease(dir),/already owns/);await releaseServer();
 assert.ok(!(await readdir(dir)).includes('Server.aidaw'));
});
