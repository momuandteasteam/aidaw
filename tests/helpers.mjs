import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../dist/service.js';
import { call } from '../dist/api.js';

export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aidaw test 日本語-'));
  const service = new Service(root);
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, service, api: (name, args = {}) => call(service, name, args) };
}
export const create = { instrument_policy:'allow_basic', project_id: 'song', name: 'テスト曲', bpm: 120, length_ticks: 3840 };
export const note = { id: 'n1', tick: 960, duration: 960, pitch: 69, velocity: 100 };
export const track = { id: 'keys', name: 'Keys', instrument: { kind: 'builtin', sound: 'sine' }, notes: [note], gain_db: -6 };
export async function seed(api, customTrack = track) {
  await api('project_create', create);
  return api('project_apply', { project_id: 'song', base_revision: 0, request_id: 'initial', operations: [{ op: 'add_track', track: customTrack }] });
}
export async function wave(path) {
  const bytes = await readFile(path);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not WAV');
  let fmt, data;
  for (let i = 12; i + 8 <= bytes.length;) {
    const n = bytes.readUInt32LE(i + 4), tag = bytes.toString('ascii', i, i + 4);
    if (tag === 'fmt ') fmt = bytes.subarray(i + 8, i + 8 + n);
    if (tag === 'data') data = bytes.subarray(i + 8, i + 8 + n);
    i += 8 + n + (n % 2);
  }
  if (!fmt || !data || fmt.readUInt16LE(14) !== 24) throw new Error('Expected 24-bit PCM');
  const channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), samples = [];
  for (let i = 0; i < data.length; i += 3 * channels) samples.push(data.readIntLE(i, 3) / 8388608);
  return { channels, rate, samples, bytes };
}
export function midiEvents(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'MThd') throw new Error('Not SMF');
  const tracks = [];
  for (let i = 14; i < buffer.length;) {
    if (buffer.toString('ascii', i, i + 4) !== 'MTrk') throw new Error('Not track');
    const end = i + 8 + buffer.readUInt32BE(i + 4); i += 8;
    let tick = 0; const events = [];
    const variable = () => { let v = 0, b; do { b = buffer[i++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
    while (i < end) {
      tick += variable(); const status = buffer[i++];
      if (status === 255) { const type = buffer[i++], size = variable(); events.push({ tick, meta: type, data: [...buffer.subarray(i, i + size)] }); i += size; }
      else { events.push({ tick, status, pitch: buffer[i++], velocity: buffer[i++] }); }
    }
    tracks.push(events);
  }
  return { ppq: buffer.readUInt16BE(12), tracks };
}
