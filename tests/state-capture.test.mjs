import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,create} from './helpers.mjs';
import {resolve} from 'node:path';
test('lost controls on state restore abort both preset saving and project edits',async t=>{
 const {api,service}=await fixture(t);const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')});const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id,parameters:[{id:'gain',value:0.7}]};
 // Fault injection isolates the persistence invariant from vendor timing: the
 // second worker reports that the explicitly edited control was lost on restore.
 const original=service.engine.call.bind(service.engine);let calls=0;
 service.engine.call=async request=>{if(request.command==='inspect'){calls++;return {state_base64:'0.',parameters:[{id:'gain',value:calls%2?0.7:0.1}]};}return original(request);};
 await assert.rejects(api('plugin_preset_save',{plugin,name:'Must fail'}),/lost parameter/);assert.equal((await service.catalog()).presets.length,0);
 await api('project_create',create);await assert.rejects(api('project_apply',{project_id:'song',base_revision:0,request_id:'reject',operations:[{op:'add_track',track:{id:'test',name:'Test',instrument:plugin,notes:[]}}]}),/lost parameter/);assert.equal((await service.read('song')).revision,0);assert.equal((await service.read('song')).tracks.length,0);
});
