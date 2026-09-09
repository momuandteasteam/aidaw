import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture, seed, track, wave } from './helpers.mjs';

test('native render has correct timing, pitch, duration and deterministic reload', async t => {
  const { service, api } = await fixture(t); await seed(api);
  const render = async () => { const j = await api('render_start', { project_id: 'song', tail_seconds: 0.5 }); return service.wait(j.job_id); };
  const first = await render(); assert.equal(first.state, 'succeeded', first.error);
  const w = await wave(first.output); assert.equal(w.rate, 48000); assert.equal(w.samples.length, 120000);
  assert.ok(w.samples.slice(0, 24000).every(v => v === 0));
  assert.ok(w.samples.slice(70000).every(v => Math.abs(v) < 1e-6));
  let crossings = 0; for (let i = 25001; i < 45000; ++i) if (w.samples[i - 1] <= 0 && w.samples[i] > 0) crossings++;
  assert.ok(Math.abs(crossings / (19999 / 48000) - 440) < 4);
  assert.ok(first.analysis.sample_peak > 0.01 && first.analysis.sample_peak < 1);
  assert.equal((await render()).sha256, first.sha256);
});
test('render revision is pinned while project changes', async t => {
  const { api, service } = await fixture(t); await seed(api);
  const j = await api('render_start', { project_id: 'song' });
  await api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'new-tempo', operations: [{ op: 'set_bpm', bpm: 60 }] });
  const done = await service.wait(j.job_id); assert.equal(done.state, 'succeeded', done.error);
  assert.equal(done.revision, 1); assert.equal(done.analysis.duration_seconds, 3); assert.equal((await service.read('song')).bpm, 60);
});
test('VST3 scan, parameter control, saved state and rendered audio work without an editor', async t => {
  const { api, service } = await fixture(t);
  const location = resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3');
  await access(location); const scanned = await api('catalog_scan', { format: 'VST3', location });
  const instrument = { kind: 'plugin', plugin_id: scanned.plugins[0].plugin_id };
  await assert.rejects(api('modo_bass_preset_import', { plugin: instrument, path: 'not-a-preset.mb2', name: 'Invalid adapter' }), /only for MODO BASS/);
  assert.equal((await api('catalog_search', { query: 'Invalid adapter' })).total_presets, 0);
  const info = await api('plugin_inspect', { plugin: instrument });
  const gain = info.parameters.find(p => p.name === 'Gain'); assert.ok(gain); assert.ok(Math.abs(gain.value - 0.3) < 1e-5);
  const preset = await api('plugin_preset_save', { plugin: { ...instrument, parameters: [{ id: gain.id, value: 0.1 }] }, name: 'Quiet sine', tags: ['test'] });
  await seed(api, { ...track, instrument: { ...instrument, preset_id: preset.id } });
  const p = await service.read('song'); assert.ok(p.tracks[0].instrument.state_base64);
  const job = await api('render_start', { project_id: 'song' }); const result = await service.wait(job.job_id);
  assert.equal(result.state, 'succeeded', result.error); assert.ok(Math.abs(result.analysis.sample_peak - 0.1 * Math.pow(10, -6 / 20) / Math.sqrt(2)) < 0.0001);
  const second = await api('render_start', { project_id: 'song' }); assert.equal((await service.wait(second.job_id)).sha256, result.sha256);
});
test('missing plugins fail explicitly without committing a substitute', async t => {
  const { api, service } = await fixture(t); await seed(api);
  await assert.rejects(api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'missing', operations: [
    { op: 'set_track', track_id: 'keys', changes: { instrument: { kind: 'plugin', plugin_id: 'missing-vst3' } } },
  ] }), /not found on this machine/);
  assert.equal((await service.read('song')).revision, 1);
});
test('VST3 effects process audio on track and master inserts', async t => {
  const { api, service } = await fixture(t);
  const location = resolve('build/aidaw-test-effect_artefacts/Release/VST3/AIDAW Test Effect.vst3');
  const scan = await api('catalog_scan', { format: 'VST3', location });
  const effect = { kind: 'plugin', plugin_id: scan.plugins[0].plugin_id };
  await seed(api);
  const j1 = await api('render_start', { project_id: 'song' }); const dry = await service.wait(j1.job_id);
  await api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'effects', operations: [
    { op: 'set_track', track_id: 'keys', changes: { effects: [effect] } }, { op: 'set_master_effects', effects: [effect] },
  ] });
  const j2 = await api('render_start', { project_id: 'song' }); const wet = await service.wait(j2.job_id);
  assert.equal(wet.state, 'succeeded', wet.error);
  assert.ok(Math.abs(wet.analysis.rms / dry.analysis.rms - 0.09) < 0.001);
});
test('macOS AU system instrument loads, saves and produces actual audio', { skip: process.platform !== 'darwin' }, async t => {
  const { api, service } = await fixture(t);
  const scan = await api('catalog_scan', { format: 'AudioUnit', location: 'AudioUnit:Synths/aumu,dls ,appl' });
  await seed(api, { ...track, instrument: { kind: 'plugin', plugin_id: scan.plugins[0].plugin_id } });
  const job = await api('render_start', { project_id: 'song' }); const result = await service.wait(job.job_id);
  assert.equal(result.state, 'succeeded', result.error); assert.ok(result.analysis.sample_peak > 0.0001);
  const loaded = await service.read('song'); assert.ok(loaded.tracks[0].instrument.state_base64);
});
test('cancel cleans up incomplete audio and preserves the project', async t => {
  const { api, service, root } = await fixture(t); await seed(api);
  const job = await api('render_start', { project_id: 'song' }); const result = await api('job_cancel', { job_id: job.job_id });
  assert.equal(result.state, 'cancelled'); assert.equal((await service.read('song')).revision, 1);
  assert.ok(!(await readdir(join(service.dir('song'), 'jobs', job.job_id, 'work'))).some(f => f.endsWith('.wav')));
});
test('a plugin update cannot silently change a saved project', async t => {
  const { api, root } = await fixture(t);
  const scanned = await api('catalog_scan', { format: 'VST3', location: resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3') });
  await seed(api, { ...track, instrument: { kind: 'plugin', plugin_id: scanned.plugins[0].plugin_id } });
  const file = join(root,'PluginLibrary.aidaw','state','host-catalog.json'), catalog = JSON.parse(await readFile(file, 'utf8'));
  catalog.plugins[0].version = '99.0.0'; await writeFile(file, JSON.stringify(catalog));
  await assert.rejects(api('render_start', { project_id: 'song' }), /version mismatch/);
});
test('concurrent render requests queue instead of running songs in parallel', async t => {
  const { api, service } = await fixture(t); await seed(api);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => api('render_start', { project_id: 'song' })));
  assert.equal(results.filter(r => r.status === 'rejected').length, 0);
  assert.equal((await api('queue_status')).max_active,1);
  assert.ok((await api('queue_status')).queued.length>=1);
  for (const r of results) if (r.status === 'fulfilled') assert.equal((await service.wait(r.value.job_id)).state, 'succeeded');
});
test('PDC aligns unequal parallel chains and a master chain at exact sample positions', async t => {
  const { api, service } = await fixture(t);
  const scan = await api('catalog_scan', { format: 'VST3', location: resolve('build/aidaw-test-effect_artefacts/Release/VST3/AIDAW Test Effect.vst3') });
  const base = { kind: 'plugin', plugin_id: scan.plugins[0].plugin_id };
  const info = await api('plugin_inspect', { plugin: base });
  const gainId = info.parameters.find(p => p.name === 'Gain').id, latencyId = info.parameters.find(p => p.name === 'Latency').id;
  const effect = samples => ({ ...base, parameters: [{ id: gainId, value: 1 }, { id: latencyId, value: samples / 4096 }] });
  await seed(api, { ...track, pan: -1 });
  await api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'right', operations: [{ op: 'add_track', track: { ...track, id: 'right', pan: 1 } }] });
  const run = async () => service.wait((await api('render_start', { project_id: 'song', tail_seconds: 0.333 })).job_id);
  const dry = await run(); assert.equal(dry.state, 'succeeded', dry.error);
  await api('project_apply', { project_id: 'song', base_revision: 2, request_id: 'delays', operations: [
    { op: 'set_track', track_id: 'keys', changes: { effects: [effect(777)] } },
    { op: 'set_track', track_id: 'right', changes: { effects: [effect(1537), effect(311)] } },
    { op: 'set_master_effects', effects: [effect(1023)] },
  ] });
  const compensated = await run(); assert.equal(compensated.state, 'succeeded', compensated.error);
  assert.equal(compensated.latency_compensation.trimmed_samples, 2871);
  assert.equal(compensated.analysis.frames, dry.analysis.frames);
  assert.equal(compensated.sha256, dry.sha256, 'Non-block-aligned PDC must preserve every sample of this unity-gain signal');
});
test('PDC removes instrument latency, preserving a note at sample zero and the final frame', async t => {
  const { api, service } = await fixture(t);
  const scan = await api('catalog_scan', { format: 'VST3', location: resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3') });
  const base = { kind: 'plugin', plugin_id: scan.plugins[0].plugin_id };
  const info = await api('plugin_inspect', { plugin: base });
  const latencyId = info.parameters.find(p => p.name === 'Latency').id;
  await seed(api, { ...track, instrument: base, notes: [{ id: 'edge', tick: 0, duration: 3840, pitch: 69, velocity: 100 }] });
  const run = async () => service.wait((await api('render_start', { project_id: 'song', tail_seconds: 0 })).job_id);
  const dry = await run();
  await api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'instrument-delay', operations: [
    { op: 'set_track', track_id: 'keys', changes: { instrument: { ...base, parameters: [{ id: latencyId, value: 2053 / 4096 }] } } },
  ] });
  const wet = await run(); assert.equal(wet.state, 'succeeded', wet.error);
  assert.equal(wet.latency_compensation.trimmed_samples, 2053); assert.equal(wet.sha256, dry.sha256);
});

test('analysis treats a one-LSB plugin residue as silent', async t => {
  const { root, api, service } = await fixture(t); await seed(api);
  const j = await api('render_start', { project_id: 'song', tail_seconds: 0 });
  const result = await service.wait(j.job_id); assert.equal(result.state, 'succeeded', result.error);
  const bytes = await readFile(result.output);
  let found = false;
  for (let i = 12; i + 8 <= bytes.length;) {
    const n = bytes.readUInt32LE(i + 4);
    if (bytes.toString('ascii', i, i + 4) === 'data') {
      for (let k = i + 8; k < i + 8 + n; k += 3) bytes.writeIntLE(1, k, 3);
      found = true;
    }
    i += 8 + n + (n % 2);
  }
  assert.ok(found);
  const path = join(root, 'plugin-residue.wav'); await writeFile(path, bytes);
  const analysis = await api('audio_analyze', { path });
  assert.equal(analysis.silent, true); assert.ok(analysis.sample_peak > 0);
});

test('isolated stems sum at unity without applying track gain or pan twice', async t => {
  const { root, api, service } = await fixture(t);
  await seed(api, { ...track, gain_db: -18, pan: 0.6 });
  const j = await api('render_start', { project_id: 'song', tail_seconds: 1 });
  const rendered = await service.wait(j.job_id); assert.equal(rendered.state, 'succeeded', rendered.error);
  const p = await service.read('song');
  const source = { ...p.tracks[0], rendered_audio_path: rendered.output };
  const result = await service.engine.call({ command: 'render', project: { ...p, tracks: [source, { ...source, id: 'second' }] }, output: join(root, 'sum.wav'), tail_seconds: 1 });
  const a = await wave(rendered.output), b = await wave(result.output);
  assert.equal(a.samples.length, b.samples.length);
  for (let i = 0; i < a.samples.length; i++) assert.ok(Math.abs(b.samples[i] - 2 * a.samples[i]) <= 1 / 8388608);
  await assert.rejects(service.engine.call({ command: 'render', project: { ...p, tracks: [source] }, output: join(root, 'bad-length.wav'), tail_seconds: 0 }), /stem format or length/);
});

test('instrument automation changes actual audio during processing and rejects unknown IDs',async t=>{
 const{api,service}=await fixture(t);
 const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')});
 const instrument={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};
 const info=await api('plugin_inspect',{plugin:instrument});const gain=info.parameters.find(p=>p.name==='Gain').id;
 await seed(api,{...track,instrument,notes:[{id:'sustain',tick:0,duration:3500,pitch:69,velocity:100}],automation:[{parameter_id:gain,points:[{tick:0,value:0},{tick:960,value:0},{tick:1920,value:.6},{tick:2880,value:0}]}]});
 const job=await api('render_start',{project_id:'song'});const result=await service.wait(job.job_id);assert.equal(result.state,'succeeded',result.error);const w=await wave(result.output);
 assert.ok(w.samples.slice(0,23000).every(x=>Math.abs(x)<1e-6));assert.ok(w.samples.slice(45000,48000).some(x=>Math.abs(x)>.1));assert.ok(w.samples.slice(73000,80000).every(x=>Math.abs(x)<1e-6));
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'bad-auto',operations:[{op:'set_track',track_id:'keys',changes:{automation:[{parameter_id:'unknown',points:[{tick:0,value:1}]}]}}]});
 const bad=await api('render_start',{project_id:'song'});assert.match((await service.wait(bad.job_id)).error,/Unknown or non-automatable/);
});
