import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,track} from './helpers.mjs';
import {niPath} from '../dist/content.js';

test('library patches are discoverable without claiming playback; partial scans preserve records',async t=>{
 const {root,api}=await fixture(t);const library=join(root,'fixture library');await mkdir(join(library,'Instruments','Guitar'),{recursive:true});await writeFile(join(library,'Instruments','Guitar','Heavy.nki'),'fixture only');await writeFile(join(library,'Warm.nksn'),'fixture only');
 const registered=await api('content_register_root',{name:'Fixture library',path:library,family:'Kontakt'});
 const report=await api('content_index',{root_ids:[registered.id]});assert.equal(report.indexed,2);assert.equal(report.state,'succeeded');
 const result=await api('content_search',{query:'guitar',family:'Kontakt'});assert.equal(result.total,1);assert.equal(result.items[0].load_status,'discovered_not_loaded');assert.equal(result.items[0].available_on_disk,true);assert.deepEqual(result.items[0].host_candidates,[]);
 const partial=await api('content_index',{max_files:1});assert.equal(partial.state,'partial');assert.equal((await api('content_search',{})).total,2);
 await rm(join(library,'Warm.nksn'));await api('content_index',{});assert.equal((await api('content_search',{})).total,1);
 assert.equal(niPath('Macintosh HD:Users:Shared:Library:'),'/Users/Shared/Library');assert.equal(niPath('C:\\Libraries\\Piano'),'C:\\Libraries\\Piano');
});

test('default projects reject basic substitutes while explicit sketch projects allow them',async t=>{
 const {api}=await fixture(t);await api('project_create',{project_id:'quality',name:'Quality',length_ticks:3840});
 await assert.rejects(api('project_apply',{project_id:'quality',base_revision:0,request_id:'reject',operations:[{op:'add_track',track}]}),/allow_basic/);
 assert.equal((await api('catalog_search',{})).builtin_sounds.length,0);assert.equal((await api('catalog_search',{include_basic:true})).builtin_sounds.length,4);
 await api('project_create',{project_id:'sketch',name:'Sketch',length_ticks:3840,instrument_policy:'allow_basic'});
 await api('project_apply',{project_id:'sketch',base_revision:0,request_id:'accept',operations:[{op:'add_track',track}]});assert.equal((await api('project_inspect',{project_id:'sketch'})).tracks.length,1);
});

test('content bindings require the exact preset probe and intact audio',async t=>{
 const {api,root}=await fixture(t);
 const {resolve}=await import('node:path');
 const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')});
 const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};
 const saved=await api('plugin_preset_save',{plugin,name:'Fixture',tags:[]});
 const folder=join(root,'patches');await mkdir(folder);await writeFile(join(folder,'fixture.fxp'),'test fixture; not a playable patch');
 await api('content_register_root',{name:'Fixture',path:folder});await api('content_index',{});const item=(await api('content_search',{})).items[0];
 const probe=await api('sound_probe',{plugin:{...plugin,preset_id:saved.id},pitches:[60]});assert.equal(probe.source_preset_id,saved.id);
 const args={content_id:item.id,preset_id:saved.id,probe_id:probe.id,description:'Test association; does not prove patch identity'};
 const binding=await api('content_bind_preset',args);assert.equal(binding.preset_id,saved.id);
 const other=await api('sound_probe',{plugin,pitches:[60]});await assert.rejects(api('content_bind_preset',{...args,probe_id:other.id}),/exact saved preset/);
 await writeFile(probe.path,'changed');await assert.rejects(api('content_bind_preset',args),/changed/);
});
