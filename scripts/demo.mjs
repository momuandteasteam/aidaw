import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Service } from '../dist/service.js';
import { call } from '../dist/api.js';
import { registerStarter } from './setup/starter.mjs';

const out = resolve('outputs/demo'); await mkdir(out, { recursive: true });
const service = new Service(join(out, '.state'));
const project_id = `demo-${randomUUID()}`;
const api = (name, input) => call(service, name, input);
const bars = 32, barTicks = 3840;
const chords = [[62, 65, 69, 72], [59, 62, 65, 69], [60, 64, 67, 71], [61, 64, 67, 69]];
const names = ['Dm7', 'G9', 'Cmaj7', 'A7'];
const roots = [38, 31, 36, 33];
const notes = { keys: [], bass: [], drums: [], melody: [] };
const add = (part, tick, duration, pitch, velocity, channel = 1) => notes[part].push({ id: `${part}-${notes[part].length}`, tick, duration, pitch, velocity, channel });
for (let bar = 0; bar < bars; bar++) {
  const base = bar * barTicks, chord = chords[bar % 4];
  for (const beat of [0, 2]) for (const pitch of chord) add('keys', base + beat * 960, 1550, pitch, 66 + (beat ? 4 : 0));
  for (const [beat, offset] of [[0, 0], [1.5, 0], [2, 12], [3, 7]]) add('bass', base + beat * 960, 660, roots[bar % 4] + offset, 83);
  for (const beat of [0, 2]) add('drums', base + beat * 960, 240, 36, 104, 10);
  for (const beat of [1, 3]) add('drums', base + beat * 960, 240, 38, 65, 10);
  for (let step = 0; step < 8; step++) add('drums', base + step * 480, 180, 42, step % 2 ? 31 : 43, 10);
  if (bar >= 8) for (const [step, index] of [[0, 2], [1.5, 1], [2.5, 3], [3, 2]]) add('melody', base + step * 960, 360, chord[index] + 12, 50);
}
const standard = await registerStarter(service,resolve('build'));
const instrument = standard.find(p=>p.name==='AIDAW GM');
const reverb = standard.find(p=>p.name==='AIDAW Reverb');
const limiter = standard.find(p=>p.name==='AIDAW Limiter');
const eq = standard.find(p=>p.name==='AIDAW EQ');
const programs = {keys:4,bass:33,drums:0,melody:11};
const tracks = Object.entries(notes).map(([id, notes]) => ({
  id, name: id, role: id, notes, gain_db: id === 'melody' ? -12 : -6, pan: id === 'keys' ? -0.2 : id === 'melody' ? 0.2 : 0,
  instrument: { kind: 'plugin', plugin_id:instrument.plugin_id, program:programs[id] },
  sends: id==='bass'?[]:[{bus_id:'reverb',gain_db:-15}],
}));
try {
  await api('project_create', { project_id, name: 'AIDAW standard pack 32-bar demo', bpm: 90, length_ticks: bars * barTicks });
  await api('project_apply', { project_id, base_revision: 0, request_id: 'arrangement', operations: [
    ...tracks.map(track => ({ op: 'add_track', track })),
    { op:'set_buses',buses:[{id:'reverb',name:'Reverb return',effects:[{kind:'plugin',plugin_id:reverb.plugin_id}],gain_db:-9}] },
    { op:'set_master_effects',effects:[{kind:'plugin',plugin_id:eq.plugin_id},{kind:'plugin',plugin_id:limiter.plugin_id}] },
    { op: 'set_sections', sections: [{ id: 'intro', name: 'Intro', start_tick: 0, end_tick: 8 * barTicks },
      { id: 'verse', name: 'Verse', start_tick: 8 * barTicks, end_tick: 24 * barTicks },
      { id: 'ending', name: 'Ending', start_tick: 24 * barTicks, end_tick: 32 * barTicks }] },
    { op: 'set_harmony', harmony: Array.from({ length: bars }, (_, bar) => ({ tick: bar * barTicks, chord: names[bar % 4] })) },
  ] });
  const started = await api('render_start', { project_id, tail_seconds: 5 });
  const result = await service.wait(started.job_id);
  if (result.state !== 'succeeded') throw new Error(result.error);
  const midi = await api('export_midi', { project_id });
  const project = await api('export_project', { project_id });
  await copyFile(result.output, join(out, 'mix.wav'));
  await copyFile(midi.output, join(out, 'song.mid'));
  await copyFile(project.output, join(out, 'song.aidaw.json'));
  await writeFile(join(out, 'report.json'), JSON.stringify({ ...result, output: join(out, 'mix.wav'), notes: midi.notes }, null, 2));
  console.log(JSON.stringify({ output: join(out, 'mix.wav'), midi: join(out, 'song.mid'), project: join(out, 'song.aidaw.json'), analysis: result.analysis, notes: midi.notes }, null, 2));
} finally { await service.close(); }
