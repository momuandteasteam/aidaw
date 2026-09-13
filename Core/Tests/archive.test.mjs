import { homePaths } from '../Build/JS/Adapters/node/workspace/home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { saveProject, importBundle, projectFilename } from '../Build/JS/Adapters/node/workspace/package.js';
import { readRevision, listHistory } from '../Build/JS/Adapters/node/workspace/history.js';
import { fixture, seed } from './helpers.mjs';

test('unrendered .aidaw.zip save preserves every edit and restored generation when imported under a new local ID',async t=>{
 const {api,service}=await fixture(t);await seed(api);
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'change',operations:[{op:'set_bpm',bpm:99}]});
 await api('project_restore',{project_id:'song',base_revision:2,request_id:'restore',revision:1});
 const saved=await saveProject(service,'song');assert.match(saved.output,/テスト曲\.aidaw\.zip$/);assert.equal(saved.frozen_audio,false);
 const bytes=await readFile(saved.output);assert.equal(bytes.subarray(0,2).toString(),'PK');const entries=unzipSync(bytes);
 assert.equal(JSON.parse(Buffer.from(entries['package.json'])).schema_version,2);assert.ok(entries['state/history/revisions/0.json']);assert.ok(!Object.keys(entries).some(name=>name.startsWith('Core/')),'project archives must not contain application repository directories');assert.ok(!Object.keys(entries).some(name=>/^(jobs|temp|outputs)\//.test(name)));
 const copied=await importBundle(service,saved.output,'copy');assert.equal(copied.revision,3);assert.equal(copied.retained_revisions,4);
 for(let revision=0;revision<=3;revision++){
  const original=await readRevision(service.dir('song'),revision),copy=await readRevision(service.dir('copy'),revision);
  assert.deepEqual({...copy,id:original.id},original);
 }
 assert.deepEqual((await listHistory(service.dir('copy'))).entries.map(entry=>entry.created_at),(await listHistory(service.dir('song'))).entries.map(entry=>entry.created_at));
 await api('project_apply',{project_id:'copy',base_revision:3,request_id:'continue',operations:[{op:'set_bpm',bpm:110}]});assert.equal((await service.read('copy')).bpm,110);
});

test('archive rejects missing history, tampered hashes, and never overwrites an existing project',async t=>{
 const {api,service,root}=await fixture(t);await seed(api);const saved=await saveProject(service,'song'),bytes=await readFile(saved.output);
 const entries=unzipSync(bytes);entries['state/history/revisions/0.json']=Buffer.from('{}');const bad=join(root,'bad.aidaw');await writeFile(bad,zipSync(entries));
 await assert.rejects(importBundle(service,bad,'bad'),/hash/);assert.ok(!(await readdir(homePaths(root).projects)).includes('bad'));
 await assert.rejects(importBundle(service,saved.output,'song'),/EEXIST/);assert.equal((await service.read('song')).revision,1);
 delete entries['state/history/revisions/0.json'];await writeFile(bad,zipSync(entries));await assert.rejects(importBundle(service,bad,'missing'),/Missing/);
});

test('both modes use .aidaw.zip while internal kind determines directories',async t=>{
 assert.equal(projectFilename('Album','mastering'),'Album.aidaw.zip');assert.equal(projectFilename('Song','composition'),'Song.aidaw.zip');
 const {service,root}=await fixture(t);await service.create({project_id:'album',name:'Album',kind:'mastering',bpm:120,length_ticks:1,meter:[4,4]});
 const saved=await saveProject(service,'album');assert.match(saved.output,/Album\.aidaw\.zip$/);
 const result=await importBundle(service,saved.output,'album-copy');assert.equal(result.kind,'mastering');
 for (const [index,name] of ['legacy.aidaw','legacy.mastering.aidaw','renamed.zip'].entries()) {
  const path=join(root,name);await writeFile(path,await readFile(saved.output));
  assert.equal((await importBundle(service,path,`legacy-${index}`)).kind,'mastering');
 }
 const state=await readdir(join(service.dir('album-copy'),'state'));assert.ok(state.includes('mastering'));assert.ok(!state.includes('composition'));assert.ok(!state.includes('midi'));
});

test('ZIP symlinks and configured resource budget overflow are rejected before import',async t=>{
 const {api,service,root}=await fixture(t);await seed(api);const saved=await saveProject(service,'song');
 await assert.rejects(importBundle(service,saved.output,'too-big',{max_compressed_bytes:16}),/resource budget/);
 const malicious=Buffer.from(zipSync({'link':Buffer.from('../outside')}));
 const central=malicious.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);
 malicious.writeUInt32LE((0xa1ff<<16)>>>0,central+38);const path=join(root,'symlink.aidaw');await writeFile(path,malicious);
 await assert.rejects(importBundle(service,path,'symlink'),/Symlink/);
});
