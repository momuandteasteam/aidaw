import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, seed } from './helpers.mjs';

async function promptly(promise, label) {
 let timer;
 try {
  return await Promise.race([
   promise,
   new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} waited for the occupied audio lane`)), 2000); }),
  ]);
 } finally { clearTimeout(timer); }
}

async function withOccupiedAudioLane(service, work) {
 let release, started;
 const entered = new Promise(resolve => { started = resolve; });
 const gate = new Promise(resolve => { release = resolve; });
 const controller = new AbortController();
 const held = service.processing.run('test-held-playback', async () => {
  started();
  await gate;
 }, { signal: controller.signal });
 // Wait for the work callback, so this proves bypass of an active lane rather than a scheduling race.
 try {
  await promptly(entered, 'test lane setup');
  assert.equal(service.processing.status().active.kind, 'test-held-playback');
  await work();
 } finally {
  release();
  controller.abort();
  await held.catch(error => { assert.match(String(error), /cancelled/i); });
 }
}

test('project document, arbitrary history reads, and editable save return while playback occupies the audio lane', async t => {
 const { api, service } = await fixture(t); await seed(api);
 await withOccupiedAudioLane(service, async () => {
  const document = await promptly(api('project_document', { project_id: 'song' }), 'project_document');
  assert.equal(document.revision, 1);
  const history = await promptly(api('project_history', { project_id: 'song', offset: 0, limit: 10 }), 'project_history');
  assert.equal(history.total, 2); assert.equal(history.entries.at(-1).revision, 0);
  const previous = await promptly(api('project_document', { project_id: 'song', revision: 0 }), 'historical project_document');
  assert.equal(previous.revision, 0);
  const saved = await promptly(api('project_save', { project_id: 'song', include_audio: false }), 'project_save');
  assert.equal(saved.revision, 1); assert.equal((await readFile(saved.output)).subarray(0, 2).toString(), 'PK');
  assert.equal(service.processing.status().active.kind, 'test-held-playback');
  assert.deepEqual(service.processing.status().queued, []);
 });
});

test('export_start acknowledges its queued job and live mix control dispatches before the audio lane is released', async t => {
 const { api, service } = await fixture(t); await seed(api);
 const originalMix = service.setPlaybackMix;
 const changes = [{ track_id: 'keys', mute: true }];
 let mixCalls = 0;
 service.setPlaybackMix = async (actualChanges, playbackId) => {
  assert.deepEqual(actualChanges, changes); assert.equal(playbackId, 'live-session');
  assert.equal(service.processing.status().active.kind, 'test-held-playback'); ++mixCalls;
  return { acknowledged: true, playback_id: playbackId };
 };
 try {
  await withOccupiedAudioLane(service, async () => {
   const exportJob = await promptly(api('export_start', {
    project_id: 'song', request_id: 'export-during-playback', scope: 'project', formats: ['wav'], tail_seconds: 0,
   }), 'export_start');
   assert.equal(exportJob.state, 'queued'); assert.ok(exportJob.job_id);
   const queue = service.processing.status();
   assert.equal(queue.active.kind, 'test-held-playback');
   assert.ok(queue.queued.some(entry => entry.id === exportJob.job_id && entry.kind === 'export'));
   const mix = await promptly(api('playback_set_mix', { playback_id: 'live-session', changes }), 'playback_set_mix');
   assert.equal(mix.acknowledged, true); assert.equal(mixCalls, 1);
   // Cancel the queued render while the test owns the lane; no native/audio work should start.
   const cancelled = await promptly(api('job_cancel', { job_id: exportJob.job_id }), 'job_cancel');
   assert.equal(cancelled.state, 'cancelled');
   assert.equal(service.processing.status().active.kind, 'test-held-playback');
   assert.deepEqual(service.processing.status().queued, []);
  });
 } finally { service.setPlaybackMix = originalMix; }
});
