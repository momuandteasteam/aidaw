import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Service } from '../dist/service.js';
import { call } from '../dist/api.js';
import { fixture, create, track, seed, midiEvents } from './helpers.mjs';

test('atomic edits, idempotent retries, conflicts and restoration survive reopening', async t => {
  const { service, api, root } = await fixture(t); await seed(api);
  const request = { project_id: 'song', base_revision: 1, request_id: 'transpose', operations: [{ op: 'transpose_notes', track_id: 'keys', start_tick: 960, end_tick: 1920, semitones: 12 }] };
  assert.equal((await api('project_apply', request)).revision, 2);
  assert.equal((await api('project_apply', request)).replayed, true);
  const reopened = new Service(root);
  assert.equal((await reopened.read('song')).tracks[0].notes[0].pitch, 81);
  await assert.rejects(api('project_apply', { ...request, request_id: 'stale' }), /Revision conflict/);
  await assert.rejects(api('project_apply', { ...request, operations: [{ ...request.operations[0], semitones: 1 }] }), /different content/);
  const before = await service.read('song');
  await assert.rejects(api('project_apply', { project_id: 'song', base_revision: 2, request_id: 'bad', operations: [
    { op: 'set_bpm', bpm: 100 }, { op: 'transpose_notes', track_id: 'keys', start_tick: 0, end_tick: 3840, semitones: 48 },
  ] }));
  assert.deepEqual(await service.read('song'), before);
  await api('project_restore', { project_id: 'song', base_revision: 2, revision: 1, request_id: 'undo' });
  assert.equal((await service.read('song')).revision, 3);
  assert.equal((await service.read('song')).tracks[0].notes[0].pitch, 69);
});
test('two independent service writers cannot lose an edit', async t => {
  const { root, api } = await fixture(t); await seed(api);
  const other = new Service(root);
  const update = request_id => ({ project_id: 'song', base_revision: 1, request_id, operations: [{ op: 'set_bpm', bpm: 95 }] });
  const results = await Promise.allSettled([api('project_apply', update('a')), call(other, 'project_apply', update('b'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await other.read('song')).revision, 2);
});
test('partial edits preserve the other range and other track', async t => {
  const { api, service } = await fixture(t); await seed(api, { ...track, notes: [
    { id: 'early', tick: 0, duration: 480, pitch: 60, velocity: 100 },
    { id: 'late', tick: 1920, duration: 480, pitch: 64, velocity: 100 },
  ] });
  await api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'second', operations: [{ op: 'add_track', track: { ...track, id: 'other' } }] });
  const before = await service.read('song');
  await api('project_apply', { project_id: 'song', base_revision: 2, request_id: 'range', operations: [{ op: 'transpose_notes', track_id: 'keys', start_tick: 1920, end_tick: 3840, semitones: 12 }] });
  const after = await service.read('song');
  assert.deepEqual(after.tracks[1], before.tracks[1]); assert.deepEqual(after.tracks[0].notes[0], before.tracks[0].notes[0]);
  assert.equal(after.tracks[0].notes[1].pitch, 76);
});
test('strict API rejects unsafe IDs, unknown fields and invalid notes', async t => {
  const { api } = await fixture(t);
  await assert.rejects(api('project_create', { ...create, project_id: '../escape' }));
  await assert.rejects(api('project_create', { ...create, unexpected: true }));
  await api('project_create', create);
  await assert.rejects(api('project_apply', { project_id: 'song', base_revision: 0, request_id: 'invalid', operations: [{ op: 'add_track', track: { ...track, notes: [{ id: 'bad', tick: 3840, duration: 1, pitch: 60, velocity: 100 }] } }] }));
  assert.equal((await api('project_inspect', { project_id: 'song' })).revision, 0);
});
test('exported MIDI parses with actual note timings, tempo and time signature', async t => {
  const { api } = await fixture(t); await seed(api);
  const output = await api('export_midi', { project_id: 'song' }); const parsed = midiEvents(await readFile(output.output));
  assert.equal(parsed.ppq, 960); assert.equal(parsed.tracks.length, 2);
  assert.deepEqual(parsed.tracks[0].find(e => e.meta === 81).data, [7, 161, 32]);
  assert.deepEqual(parsed.tracks[0].find(e => e.meta === 88).data, [4, 2, 24, 8]);
  assert.deepEqual(parsed.tracks[1].filter(e => e.status), [
    { tick: 960, status: 144, pitch: 69, velocity: 100 }, { tick: 1920, status: 128, pitch: 69, velocity: 0 },
  ]);
});
test('portable JSON reimports with notes and without machine paths', async t => {
  const { api, service } = await fixture(t); await seed(api);
  const exported = await api('export_project', { project_id: 'song' });
  const json = JSON.parse(await readFile(exported.output, 'utf8'));
  await api('project_import', { project_id: 'copy', project: json });
  const copy = await service.read('copy'); assert.equal(copy.revision, 0); assert.deepEqual(copy.tracks, json.tracks);
  assert.ok(!JSON.stringify(json).includes('description_xml'));
});
test('setting one track property never reapplies creation defaults to omitted properties', async t => {
  const { api, service } = await fixture(t);
  await seed(api, { ...track, role: 'lead', gain_db: -18, pan: -0.75 });
  await api('project_apply', { project_id: 'song', base_revision: 1, request_id: 'only-name', operations: [
    { op: 'set_track', track_id: 'keys', changes: { name: 'Renamed' } },
  ] });
  const t1 = (await service.read('song')).tracks[0];
  assert.equal(t1.name, 'Renamed'); assert.equal(t1.role, 'lead'); assert.equal(t1.gain_db, -18); assert.equal(t1.pan, -0.75);
});
test('100 editing commands keep exactly five project directories; notation MIDI excludes keyswitches',async t=>{
 const {api,service}=await fixture(t);await seed(api,{...track,notes:[{id:'music',tick:960,duration:960,pitch:40,display_pitch:28,velocity:100},{id:'switch',tick:0,duration:1,pitch:12,purpose:'keyswitch',velocity:100}]});
 for(let i=0;i<100;i++)await api('project_apply',{project_id:'song',base_revision:i+1,request_id:`edit-${i}`,operations:[{op:'set_bpm',bpm:120+i%2}]});
 const {readdir}=await import('node:fs/promises');const entries=await readdir(service.dir('song'),{withFileTypes:true});assert.deepEqual(entries.filter(e=>e.isDirectory()).map(e=>e.name).sort(),['assets','jobs','outputs','state','temp']);
 const exported=await api('export_notation_midi',{project_id:'song'});const parsed=midiEvents(await readFile(exported.output));const on=parsed.tracks.flat().filter(e=>(e.status&0xf0)===0x90&&e.velocity>0);assert.deepEqual(on.map(e=>e.pitch),[28]);
 const performance=await api('export_midi',{project_id:'song'});const played=midiEvents(await readFile(performance.output)).tracks.flat().filter(e=>(e.status&0xf0)===0x90&&e.velocity>0);assert.deepEqual(played.map(e=>e.pitch),[12,40]);
});
