import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { appendFile,readdir } from 'node:fs/promises';
import { fixture } from './helpers.mjs';
test('caller-owned audition, append-only review and parameter database',async t=>{
 const {api,root}=await fixture(t);
 const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')});
 const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};
 const index=await api('effect_index',{plugin});assert.equal(index.meaning_status,'unmapped');assert.ok(index.parameters.length);
 const probe=await api('sound_probe',{plugin,pitches:[48,60],velocity:100});
 assert.equal(probe.review_status,'audio_review_pending');assert.ok(probe.analysis.sample_peak>0);assert.equal(probe.mime_type,'audio/wav');
 const review={probe_id:probe.id,audio_sha256:probe.audio_sha256,method:'metadata_inference',reviewer:'test-only numerical inference',description:'Test fixture, not a listening result',tags:['fixture'],uses:['test'],confidence:0.1};
 await assert.rejects(api('sound_assess',{...review,audio_sha256:'0'.repeat(64)}),/does not match/);
 await api('sound_assess',review);await api('sound_assess',{...review,description:'Second independent record'});
 const found=await api('knowledge_search',{query:'fixture',kind:'assessment'});assert.equal(found.length,2);assert.ok(found.every(x=>x.method==='metadata_inference'));
 await appendFile(probe.path,'changed');await assert.rejects(api('sound_assess',review),/changed/);
 assert.deepEqual((await readdir(join(root,'PluginLibrary.aidaw'))).sort(),['assets','jobs','outputs','state','temp']);
});
test('bounded batch resumes in place, frozen cache is reused, and compatibility has evidence',async t=>{
 const {api,root}=await fixture(t);const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')});const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};
 const first=await api('catalog_index');assert.equal(first.added,1);assert.equal((await api('catalog_index')).added,0);
 const batch=await api('instrument_probe',{plugins:[plugin,{kind:'plugin',plugin_id:'unavailable'}],pitches:[60]});assert.equal(batch.state,'failed');assert.equal(batch.tasks[0].state,'succeeded');
 const old=await readdir(join(root,'PluginLibrary.aidaw','jobs'));const resumed=await api('instrument_probe_resume',{job_id:batch.id});assert.equal(resumed.tasks[0].attempt,1);assert.equal(resumed.tasks[1].attempt,2);assert.deepEqual(await readdir(join(root,'PluginLibrary.aidaw','jobs')),old);
 const cached=await api('sound_probe',{plugin,pitches:[60]});assert.equal(cached.reused_frozen_take,true);
 const verified=await api('plugin_verify',{plugin});assert.equal(verified.state_roundtrip,'parameter_readback_passed');assert.equal(verified.reproducibility,'bit_exact_samples');assert.equal(verified.automation,'not_tested');
 const index=await api('effect_index',{plugin});await assert.rejects(api('parameter_annotate',{snapshot_id:index.id,parameter_id:'missing',meaning:'Gain',evidence:'test'}),/Unknown parameter/);
});
test('effect probes preserve before/after evidence and loudness analysis never modifies audio',async t=>{
 const {api}=await fixture(t);
 const instrument=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')});
 const source=await api('sound_probe',{plugin:{kind:'plugin',plugin_id:instrument.plugins[0].plugin_id},pitches:[60]});
 const effect=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-effect_artefacts/Release/VST3/AIDAW Test Effect.vst3')});
 const after=await api('effect_probe',{plugin:{kind:'plugin',plugin_id:effect.plugins[0].plugin_id},path:source.path});assert.equal(after.input_sha256,source.audio_sha256);assert.notEqual(after.audio_sha256,source.audio_sha256);assert.ok(after.output_analysis.sample_peak>0);
 const measurement=await api('audio_measure',{path:source.path});assert.equal(measurement.audio_sha256,source.audio_sha256);assert.ok(Number.isFinite(measurement.integrated_lufs));assert.ok(Number.isFinite(measurement.true_peak_dbtp));
});
