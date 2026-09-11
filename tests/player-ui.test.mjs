import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIsPlayable, startFrame, statusBelongsToProject } from '../player/renderer/model.mjs';

test('player does not carry a completed position or stale status into another project', () => {
  assert.equal(startFrame('96000', '96000'), '0');
  assert.equal(startFrame('12000', '96000'), '12000');
  assert.equal(statusBelongsToProject({ project_id: 'old', state: 'failed', position_frame: '96000' }, 'new'), false);
  assert.equal(statusBelongsToProject({ project_id: 'new', state: 'playing' }, 'new'), true);
});

test('batch containers without tracks are not playable', () => {
  assert.equal(projectIsPlayable({ playable: false, track_count: 0 }), false);
  assert.equal(projectIsPlayable({ playable: true, track_count: 1 }), true);
});
