import { createLocalApplication } from '../Build/JS/Application/local-application.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../Build/JS/Application/service.js';
import {call} from '../Build/JS/Application/api.js';
import {atomicJson} from '../Build/JS/Adapters/node/workspace/storage.js';
import {parseDocument} from '../Build/JS/Domain/domain.js';

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'aidaw-context-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const one=new Service(root),two=new Service(root);
 await one.create({project_id:'song',name:'Song',bpm:120,length_ticks:3840,meter:[4,4]});
 return {root,one,two};
}
test('active selection is shared across services, bypasses audio queue and never edits the document',async t=>{
 const {one,two}=await fixture(t),before=await readFile(join(one.dir('song'),'project.json'),'utf8');
 assert.equal((await call(createLocalApplication(two),'active_context_get',{})).available,false);
 one.processing.run=()=>{throw Error('Must bypass audio queue');};
 await call(createLocalApplication(one),'active_context_set',{project_id:'song',revision:0});
 const selected=await call(createLocalApplication(two),'active_context_get',{});
 assert.equal(selected.project_id,'song');assert.equal(selected.kind,'composition');assert.equal(selected.selected_revision,0);
 assert.equal(await readFile(join(one.dir('song'),'project.json'),'utf8'),before);
 await call(createLocalApplication(two),'project_apply',{project_id:'song',base_revision:0,request_id:'edit',operations:[{op:'set_bpm',bpm:99}]});
 const fresh=await call(createLocalApplication(one),'active_context_get',{});
 assert.equal(fresh.revision,1);assert.equal(fresh.selected_revision,0);
 await call(createLocalApplication(two),'active_context_set',{project_id:null});
 assert.equal((await call(createLocalApplication(one),'active_context_get',{})).available,false);
});
test('invalid targets preserve prior selection and removed projects are reported unavailable',async t=>{
 const {one,two}=await fixture(t);
 await call(createLocalApplication(one),'active_context_set',{project_id:'song'});
 for(const selection of [{project_id:'missing'},{project_id:'song',song_id:'invalid'}, {project_id:'song',revision:999},{project_id:null,revision:0}]) {
  await assert.rejects(call(createLocalApplication(two),'active_context_set',selection));
  assert.equal((await one.activeContext()).project_id,'song');
 }
 await rm(one.dir('song'),{recursive:true});
 const missing=await two.activeContext();assert.equal(missing.available,false);assert.equal(missing.reason,'selection_unavailable');
});
test('mastering selection validates song versions and keeps comparisons out of authored state',async t=>{
 const {one,two}=await fixture(t);
 const version={id:'v1',label:'First',created_at:new Date().toISOString(),created_revision:0,source_asset_id:'source',source_sha256:'a'.repeat(64),clip:{kind:'audio',asset_id:'source',end_frame:'48000'},duration_frames:'48000'};
 const song={id:'track',name:'Track',versions:[version],current_version_id:'v1',comparison:{a:{kind:'source',source_asset_id:'source'},b:{kind:'version',version_id:'v1'}}};
 const document=parseDocument({schema_version:3,kind:'mastering',id:'album',name:'Album',revision:0,mastering:{song_order:['track'],songs:[song]}});
 await atomicJson(join(one.dir('album'),'project.json'),{project:document,receipts:{}});
 await one.selectActiveContext({project_id:'album',song_id:'track',comparison:'a'});
 const selected=await two.activeContext();assert.equal(selected.song_id,'track');assert.equal(selected.comparison,'a');assert.equal(selected.audition_selection.kind,'source');
 for(const extra of [{song_id:'missing'},{song_id:'track',version_id:'missing'},{song_id:'track',version_id:'v1',comparison:'a'},{version_id:'v1'}])await assert.rejects(two.selectActiveContext({project_id:'album',...extra}));
 assert.deepEqual(await one.readDocument('album'),document);
 await two.selectActiveContext({project_id:'album'});
 assert.equal((await one.activeContext()).song_id,null);
});
