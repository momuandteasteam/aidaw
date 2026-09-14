import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {effectChain} from '../Build/JS/Contracts/effect-chain.js';
import {EffectChains} from '../Build/JS/Application/effect-chains.js';
import {fixture,seed} from './helpers.mjs';
const selection={chain_id:'aidaw-mastering-chain',chain_version:'0.0.1',enabled:{},parameters:{}};
const source=JSON.parse(await readFile(new URL('../../Workflows/Templates/EffectChains/aidaw-mastering-chain.json',import.meta.url),'utf8'));
test('chain strict schema and canonical stage ordering',()=>{
 assert.deepEqual(effectChain.parse(source).stages.map(s=>s.id),['gain','eq','enhancer','reverb','imager','bassmono','limiter']);assert.equal(source.stages.find(s=>s.id==='reverb').enabled,false);
 assert.throws(()=>effectChain.parse({...source,code:'bad'}));assert.throws(()=>effectChain.parse({...source,stages:[source.stages[0],source.stages[0]]}));
});
test('chain resolves exact versions and overrides without loading disabled plugins',async()=>{
 const loaded=[],plugins=source.stages.map(s=>({...s.plugin,plugin_id:s.id,instrument:false,location:'fixture'}));
 const fake={catalog:async()=>({plugins}),inspectPlugin:async spec=>{loaded.push(spec.plugin_id);return {parameters:source.stages.find(s=>s.id===spec.plugin_id).parameters.map((p,i)=>({id:String(i),name:p.name}))};}};
 const chains=new EffectChains(fake);assert.equal((await chains.list()).chains[0].name,'AIDAW Mastering Chain');
 const result=await chains.resolve({...selection,parameters:{gain:[{name:'Gain dB',value:.75}]}});assert.deepEqual(loaded,['gain','eq','enhancer','imager','limiter']);assert.equal(result.effects[0].parameters[0].value,.75);
 await assert.rejects(chains.resolve({...selection,chain_version:'99.0.0'}),/version/);await assert.rejects(chains.resolve({...selection,enabled:{unknown:true}}),/stage/);await assert.rejects(chains.resolve({...selection,parameters:{gain:[{name:'unknown',value:0}]}}),/parameter/);plugins[0].version='other';await assert.rejects(chains.resolve(selection),/matching plugin/);
});
test('native chain apply freezes state, is replayable, renders, and preserves mastering parent',async t=>{
 const {api,service}=await fixture(t);await seed(api);
 const apply={...selection,project_id:'song',base_revision:1,request_id:'chain',target:{kind:'master'},parameters:{gain:[{name:'Gain dB',value:.75}]}};
 await assert.rejects(api('effect_chain_apply',apply),/matching plugin/);assert.equal((await service.readDocument('song')).revision,1);
 for(const name of ['Gain','EQ','Enhancer','Imager','Limiter'])await api('catalog_scan',{format:'VST3',location:resolve('Core/Build/Native/starter',`aidaw-starter-${name.toLowerCase()}_artefacts/Release/VST3/AIDAW ${name}.vst3`)});
 const resolved=await api('effect_chain_resolve',selection);assert.equal(resolved.effects.length,5);
 await api('effect_chain_apply',apply);assert.equal((await api('effect_chain_apply',apply)).replayed,true);
 const graph=await service.read('song');assert.ok(graph.master_effects.every(p=>p.state_base64));const readback=await api('plugin_inspect',{plugin:graph.master_effects[0]});assert.ok(Math.abs(readback.parameters.find(p=>p.name==='Gain dB').value-.75)<1.e-5);
 await assert.rejects(api('effect_chain_apply',{...apply,request_id:'stale'}),/revision|conflict/i);
 const job=await api('render_start',{project_id:'song',tail_seconds:0}),render=await service.wait(job.job_id);assert.equal(render.state,'succeeded',render.error);assert.ok(render.analysis.sample_peak>0);
 await api('project_create',{project_id:'album',kind:'mastering',name:'Album'});const asset=await api('asset_import',{project_id:'album',path:render.output,role:'source'});await api('mastering_add_song',{project_id:'album',base_revision:0,request_id:'original',song_id:'one',name:'One',asset_id:asset.id});const prior=structuredClone((await service.readDocument('album')).mastering.songs[0].versions[0]);
 const master={...selection,project_id:'album',base_revision:1,request_id:'mastered',target:{kind:'mastering',song_id:'one',parent_version_id:'original'}};await api('effect_chain_apply',master);assert.equal((await api('effect_chain_apply',master)).replayed,true);const song=(await service.readDocument('album')).mastering.songs[0];assert.deepEqual(song.versions[0],prior);assert.equal(song.versions.length,2);assert.equal(song.versions[1].effects.length,5);assert.ok(song.versions[1].effects.every(p=>p.state_base64));
});
