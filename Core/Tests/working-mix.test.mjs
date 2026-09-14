import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,seed} from './helpers.mjs';
import {Service} from '../Build/JS/Application/service.js';
import {getWorkingMix} from '../Build/JS/Adapters/node/workspace/working-mix.js';
const p={project_id:'song'};
async function set(api,values,extra={}){const m=await api('working_mix_get',p);return api('working_mix_set',{...p,base_revision:m.revision,expected_token:m.token,target:{kind:'track',track_id:'keys'},values,...extra});}
const edit=(revision,request_id,operations=[{op:'set_bpm',bpm:110}])=>({...p,base_revision:revision,request_id,operations});
test('GUI adjustments survive reopening without revisions and CAS rejects stale writes',async t=>{
 const {api,root}=await fixture(t);await seed(api);await set(api,{gain_db:-9,pan:.2});
 const other=new Service(root);t.after(()=>other.close());const m=await getWorkingMix(other,'song');assert.equal(m.revision,1);assert.equal(m.entries[0].values.gain_db,-9);
 await assert.rejects(set(api,{pan:.4},{expected_token:'0'}),/token conflict/);
 await set(api,{gain_db:-6,pan:0});assert.equal((await api('working_mix_get',p)).entries.length,0);assert.equal((await api('project_document',p)).revision,1);
});
test('pending edits block AI and export; include is one revision and AI undo preserves GUI mix',async t=>{
 const {api}=await fixture(t);await seed(api);await set(api,{gain_db:-9,pan:.2});
 await assert.rejects(api('project_apply',edit(1,'ai')),/GUI_ADJUSTMENTS_PENDING/);
 await assert.rejects(api('export_start',{...p,request_id:'export',formats:['wav']}),/GUI_ADJUSTMENTS_PENDING/);
 const m=await api('working_mix_get',p),resolve={...p,token:m.token,action:'include',request_id:'include'};
 assert.equal((await api('working_mix_resolve',resolve)).revision,2);
 assert.equal((await api('project_apply',edit(2,'ai'))).revision,3);
 assert.equal((await api('working_mix_resolve',resolve)).revision,2);
 await api('project_restore',{...p,base_revision:3,revision:2,request_id:'undo-ai'});
 const doc=await api('project_document',p);assert.equal(doc.composition.tracks[0].gain_db,-9);assert.equal(doc.composition.bpm,120);
 assert.equal((await api('working_mix_get',p)).entries.length,0);
});
test('keep preserves unrelated adjustments, detects changed fields, and discard does not author a revision',async t=>{
 const {api}=await fixture(t);await seed(api);let m=await set(api,{pan:.4});
 await api('project_apply',{...edit(1,'keep'),working_copy:{action:'keep',token:m.token}});
 assert.equal((await api('working_mix_get',p)).entries[0].status,'pending');
 await api('project_apply',{...edit(2,'change-pan',[{op:'set_track',track_id:'keys',changes:{pan:-.5}}]),working_copy:{action:'keep',token:m.token}});
 m=await api('working_mix_get',p);assert.equal(m.entries[0].status,'conflict');
 await assert.rejects(api('working_mix_resolve',{...p,token:m.token,action:'include',request_id:'conflict'}),/conflict/);
 const r=await api('working_mix_resolve',{...p,token:m.token,action:'discard',request_id:'discard'});assert.equal(r.revision,3);assert.equal((await api('working_mix_get',p)).entries.length,0);
});
test('an adjustment made during include is retained and duplicate requests do not double commit',async t=>{
 const {api,service}=await fixture(t);await seed(api);const m=await set(api,{gain_db:-9});const original=service.apply.bind(service);let once=true;
 service.apply=async a=>{if(a.working_mix_resolution&&once){once=false;await set(api,{gain_db:-12});}return original(a);};
 const args={...p,token:m.token,action:'include',request_id:'include'};
 const results=await Promise.all([api('working_mix_resolve',args),api('working_mix_resolve',args)]);assert.equal(results[0].revision,2);assert.deepEqual(results[0],results[1]);
 const pending=await api('working_mix_get',p);assert.equal(pending.entries[0].values.gain_db,-12);assert.equal(pending.entries[0].status,'pending');assert.equal(pending.entries[0].base_values.gain_db,-9);assert.equal((await api('project_document',p)).composition.tracks[0].gain_db,-9);
});

test('returning to baseline during include remains a pending reverse adjustment',async t=>{
 const {api,service}=await fixture(t);await seed(api);const m=await set(api,{gain_db:-9});const original=service.apply.bind(service);
 service.apply=async a=>{if(a.working_mix_resolution)await set(api,{gain_db:-6});return original(a);};
 await api('working_mix_resolve',{...p,token:m.token,action:'include',request_id:'include'});
 const pending=await api('working_mix_get',p);assert.equal(pending.entries[0].values.gain_db,-6);assert.equal(pending.entries[0].base_values.gain_db,-9);assert.equal(pending.entries[0].status,'pending');
});
test('mastering input gain creates one new version and never rewrites its parent',async t=>{
 const {api,service,root}=await fixture(t);const {writeFile}=await import('node:fs/promises');
 service.engine.analyze=async()=>({sample_rate:48000,frames:48000,channels:2});
 await api('project_create',{project_id:'album',kind:'mastering',name:'Album'});await writeFile(root+'/source.wav','fake engine fixture');
 const asset=await api('asset_import',{project_id:'album',path:root+'/source.wav',role:'source'});
 await api('mastering_add_song',{project_id:'album',base_revision:0,request_id:'initial',song_id:'one',name:'One',asset_id:asset.id});
 const m=await api('working_mix_set',{project_id:'album',base_revision:1,expected_token:'0',target:{kind:'mastering',song_id:'one',version_id:'initial'},values:{gain_db:-3}});
 await api('working_mix_resolve',{project_id:'album',token:m.token,action:'include',request_id:'include'});
 const d=await api('project_document',{project_id:'album'}),song=d.mastering.songs[0];assert.equal(d.revision,2);assert.equal(song.versions.length,2);assert.equal(song.versions[0].input_gain_db,0);assert.equal(song.versions[1].input_gain_db,-3);assert.equal(song.current_version_id,song.versions[1].id);
});
