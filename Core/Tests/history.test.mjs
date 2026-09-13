import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeHistory, ensureHistory, writeRevision, readRevision, listHistory } from '../Build/JS/Adapters/node/workspace/history.js';
import { atomicJson } from '../Build/JS/Adapters/node/workspace/storage.js';
import { fixture, seed } from './helpers.mjs';

test('history stores stable-ID note deltas and shares unchanged plugin state across 100 revisions',async t=>{
 const {root}=await fixture(t),dir=join(root,'history-case');
 let state={revision:0,tracks:[{id:'lead',notes:Array.from({length:100},(_,i)=>({id:`n${i}`,pitch:60})),instrument:{state_base64:'cGx1Z2luIHN0YXRl'}}]};
 let head=await initializeHistory(dir,state);await atomicJson(join(dir,'project.json'),{project:state,history:head,receipts:{}});
 const originals=[structuredClone(state)];
 for(let revision=1;revision<=100;revision++){
  const next=structuredClone(state);next.revision=revision;next.tracks[0].notes[42].pitch=60+revision%12;
  head=await writeRevision(dir,state,next,{request_id:`edit-${revision}`});await atomicJson(join(dir,'project.json'),{project:next,history:head});state=next;originals.push(structuredClone(state));
 }
 const delta=JSON.parse(await readFile(join(dir,'state/history/revisions/99.json'),'utf8'));
 assert.ok(delta.changes.some(change=>change.path.join('/')==='tracks/items/lead/notes/items/n42/pitch'));
 assert.ok((await readFile(join(dir,'state/history/revisions/99.json'))).length<1000);
 assert.equal((await readdir(join(dir,'state/history/objects'))).length,1);
 for(const revision of [0,49,50,99,100])assert.deepEqual(JSON.parse(JSON.stringify(await readRevision(dir,revision))),originals[revision]);
 const listing=await listHistory(dir,90,20);assert.equal(listing.total,101);assert.equal(listing.entries.length,11);assert.equal(listing.entries.at(-1).revision,0);
});

test('unpublished revisions are invisible and a published revision survives missing job status',async t=>{
 const {root}=await fixture(t),dir=join(root,'atomic-case');const before={revision:0,value:1},after={revision:1,value:2};
 const initial=await initializeHistory(dir,before);await atomicJson(join(dir,'project.json'),{project:before,history:initial});
 const head=await writeRevision(dir,before,after,{request_id:'first'});
 assert.deepEqual(JSON.parse(JSON.stringify(await readRevision(dir,0))),before);await assert.rejects(readRevision(dir,1),/unpublished/);assert.equal((await listHistory(dir)).total,1);
 await atomicJson(join(dir,'project.json'),{project:after,history:head});assert.equal((await readRevision(dir,1)).value,2);
 await writeFile(join(dir,'state/history/revisions/0.json'),JSON.stringify({...JSON.parse(await readFile(join(dir,'state/history/revisions/0.json'),'utf8')),summary:'tampered'}));
 await assert.rejects(readRevision(dir,0),/Broken history/);
});

test('service edits keep only revision references in jobs and restore creates a new retained generation',async t=>{
 const {api,service}=await fixture(t);await seed(api);
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'change',operations:[{op:'set_bpm',bpm:99}]});
 await api('project_restore',{project_id:'song',base_revision:2,request_id:'restore',revision:1});
 assert.equal((await service.read('song')).revision,3);assert.equal((await service.read('song')).bpm,120);
 assert.equal((await readRevision(service.dir('song'),2)).composition.bpm,99);
 const files=await readdir(join(service.dir('song'),'jobs'),{recursive:true});assert.ok(!files.some(name=>/(before|after)\.json$/.test(name)));
 assert.equal((await listHistory(service.dir('song'))).total,4);
});

test('legacy retained snapshots migrate before a new delta without silently discarding earlier versions',async t=>{
 const {root}=await fixture(t),dir=join(root,'legacy-case');
 for(let revision=0;revision<=2;revision++){
  await atomicJson(join(dir,'jobs',`legacy-${revision}`,'status.json'),{state:'succeeded'});
  await atomicJson(join(dir,'jobs',`legacy-${revision}`,'snapshots/after.json'),{revision,value:revision});
 }
 const current={revision:2,value:2};await atomicJson(join(dir,'project.json'),{project:current,receipts:{}});
 const head=await ensureHistory(dir,current);await atomicJson(join(dir,'project.json'),{project:current,history:head,receipts:{}});
 assert.equal((await listHistory(dir)).total,3);assert.deepEqual(await readRevision(dir,0),{revision:0,value:0});
});
