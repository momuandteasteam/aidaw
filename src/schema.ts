import { z } from 'zod';

export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const parameter = z.object({ id: z.string().min(1), value: z.number().min(0).max(1) }).strict();
export const frame = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v=>BigInt(v)<=86400000n,'Frame range exceeds 30 minutes at 48kHz');
export const automationLane = z.object({
  parameter_id: z.string().min(1),
  interpolation: z.enum(['linear', 'hold']).default('linear'),
  points: z.array(z.union([z.object({tick:z.number().int().min(0),value:z.number().min(0).max(1)}).strict(),z.object({frame,value:z.number().min(0).max(1)}).strict()])).min(1).max(20000),
}).strict();
export const plugin = z.object({
  kind: z.literal('plugin'), plugin_id: z.string().min(1).max(512),
  preset_id: id.optional(),
  plugin_version: z.string().max(200).optional(),
  state_base64: z.string().max(32_000_000).optional(),
  program: z.number().int().min(0).max(100000).optional(),
  parameters: z.array(parameter).max(4096).default([]),
  automation:z.array(automationLane).max(64).optional(),
}).strict();
export const audioInstrument = z.object({kind:z.literal('audio'),asset_id:z.string().min(1),start_frame:frame.default('0'),end_frame:frame.optional(),timeline_frame:frame.default('0'),fade_in_frames:frame.default('0'),fade_out_frames:frame.default('0')}).strict();
export const instrument = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), sound: z.enum(['sine', 'keys', 'bass', 'drums']) }).strict(), plugin, audioInstrument,
]);
export const note = z.object({
  display_pitch:z.number().int().min(0).max(127).optional(),purpose:z.enum(['musical','keyswitch']).optional(),
  id, tick: z.number().int().min(0).max(10_000_000), duration: z.number().int().min(1).max(10_000_000),
  pitch: z.number().int().min(0).max(127), velocity: z.number().int().min(1).max(127),
  channel: z.number().int().min(1).max(16).default(1),
}).strict();
export const send = z.object({bus_id:id,gain_db:z.number().min(-96).max(12),position:z.enum(['pre_fader','post_fader']).default('post_fader'),enabled:z.boolean().default(true)}).strict();
export const bus = z.object({id,name:z.string().min(1).max(200),effects:z.array(plugin).max(16),gain_db:z.number().min(-96).max(12).default(0),pan:z.number().min(-1).max(1).default(0),mute:z.boolean().default(false),solo:z.boolean().default(false)}).strict();
export const track = z.object({
  id, name: z.string().min(1).max(200), role: z.string().max(100).default(''), instrument,
  gain_db: z.number().min(-96).max(12).default(-6), pan: z.number().min(-1).max(1).default(0),
  automation: z.array(automationLane).max(64).default([]),
  mute:z.boolean().default(false),solo:z.boolean().default(false),to_master:z.boolean().default(true),
  sends:z.array(send).max(16).default([]),
  notes: z.array(note).max(100000).default([]), effects: z.array(plugin).max(16).default([]),
}).strict();
export const section = z.object({ id, name: z.string().max(200), start_tick: z.number().int().min(0), end_tick: z.number().int().positive() }).strict();
export const harmony = z.object({ tick: z.number().int().min(0), chord: z.string().min(1).max(100) }).strict();
export const project = z.object({
  instrument_policy:z.enum(['plugin_first','allow_basic']).default('plugin_first'),
  schema_version: z.union([z.literal(1),z.literal(2)]), id, name: z.string().min(1).max(200), revision: z.number().int().nonnegative(),
  sample_rate: z.literal(48000), ppq: z.literal(960), bpm: z.number().min(20).max(300),
  meter: z.tuple([z.number().int().min(1).max(32), z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)])]),
  length_ticks: z.number().int().min(1).max(10_000_000),
  duration_frames: frame.optional(),
  tracks: z.array(track).max(64), sections: z.array(section).max(256), harmony: z.array(harmony).max(4096),
  buses:z.array(bus).max(16).default([]),
  master_effects: z.array(plugin).max(16),
}).strict().superRefine((p, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message });
  if(new Set([...p.tracks,...p.buses].map(t=>t.id)).size!==p.tracks.length+p.buses.length)error('Duplicate track/bus IDs');
  if (new Set(p.tracks.map(t => t.id)).size !== p.tracks.length) error('Duplicate track IDs');
  if(p.duration_frames==='0')error('Duration must be positive');
  if(p.buses.length&&!p.tracks.length)error('Buses require at least one input track');
  if (new Set(p.sections.map(s => s.id)).size !== p.sections.length) error('Duplicate section IDs');
  if (p.length_ticks * 60 / (p.bpm * 960) > 1770) error('Project exceeds 29.5 minutes');
  for (const t of p.tracks) {
    if(new Set(t.sends.map(s=>s.bus_id)).size!==t.sends.length)error('Duplicate send destination');
    for(const send of t.sends)if(!p.buses.some(b=>b.id===send.bus_id))error('Unknown send bus');
    if (new Set(t.notes.map(n => n.id)).size !== t.notes.length) error(`Duplicate note IDs in ${t.id}`);
    if(t.instrument.kind==='audio'){const a=t.instrument;if(t.notes.length)error('Audio tracks cannot contain MIDI notes');if(a.end_frame!==undefined&&BigInt(a.end_frame)<=BigInt(a.start_frame))error('Invalid audio clip range');}
    if (t.automation.length && t.instrument.kind !== 'plugin') error('Automation requires a plugin instrument');
    if (new Set(t.automation.map(a => a.parameter_id)).size !== t.automation.length) error('Duplicate automation parameter');
    for (const n of t.notes) if (n.tick + n.duration > p.length_ticks || (p.duration_frames!==undefined&&(n.tick+n.duration)*60*48000/(p.bpm*960)>Number(p.duration_frames))) error(`Note ${n.id} exceeds project length`);
  }
  const groups=[...p.tracks.flatMap(t=>[t.automation,...t.effects.map(f=>f.automation??[]),...(t.instrument.kind==='plugin'?[t.instrument.automation??[]]:[])]),...p.master_effects.map(f=>f.automation??[]),...p.buses.flatMap(b=>b.effects.map(f=>f.automation??[]))];
  const end=p.duration_frames?Number(p.duration_frames):p.length_ticks*60*48000/(p.bpm*960);
  for(const lanes of groups){if(new Set(lanes.map(l=>l.parameter_id)).size!==lanes.length)error('Duplicate automation parameter');for(const lane of lanes){let last=-1;for(const point of lane.points){const pos='frame' in point?Number(point.frame):point.tick*60*48000/(p.bpm*960);if(pos<=last||pos>end)error('Automation points must be ordered within project length');last=pos;}}}
  for (const s of p.sections) if (s.start_tick >= s.end_tick || s.end_tick > p.length_ticks) error(`Invalid section ${s.id}`);
  for (const h of p.harmony) if (h.tick >= p.length_ticks) error('Harmony exceeds project length');
});
export const operation = z.discriminatedUnion('op', [
  z.object({op:z.literal('set_timing'),length_ticks:z.number().int().min(1).max(10000000),meter:z.tuple([z.number().int().min(1).max(32),z.union([z.literal(2),z.literal(4),z.literal(8),z.literal(16)])])}).strict(),
  z.object({op:z.literal('set_bus'),bus_id:id,changes:z.object({name:bus.shape.name.optional(),effects:bus.shape.effects.optional(),gain_db:bus.shape.gain_db.removeDefault().optional(),pan:bus.shape.pan.removeDefault().optional(),mute:bus.shape.mute.removeDefault().optional(),solo:bus.shape.solo.removeDefault().optional()}).strict()}).strict(),
  z.object({op:z.literal('set_buses'),buses:z.array(bus).max(16)}).strict(),
  z.object({op:z.literal('set_duration_frames'),duration_frames:frame}).strict(),
  z.object({op:z.literal('edit_audio_clip'),track_id:id,changes:z.object({start_frame:frame.optional(),end_frame:frame.nullable().optional(),timeline_frame:frame.optional(),fade_in_frames:frame.optional(),fade_out_frames:frame.optional()}).strict()}).strict(),
  z.object({ op: z.literal('add_track'), track }).strict(),
  z.object({ op: z.literal('remove_track'), track_id: id }).strict(),
  z.object({ op: z.literal('replace_notes'), track_id: id, notes: z.array(note).max(100000) }).strict(),
  z.object({ op: z.literal('set_track'), track_id: id, changes: z.object({
    mute:z.boolean().optional(),solo:z.boolean().optional(),to_master:z.boolean().optional(), name: track.shape.name.optional(), role: track.shape.role.removeDefault().optional(),
    instrument: instrument.optional(), gain_db: track.shape.gain_db.removeDefault().optional(),
    sends:track.shape.sends.removeDefault().optional(), pan: track.shape.pan.removeDefault().optional(), automation: track.shape.automation.removeDefault().optional(), effects: track.shape.effects.removeDefault().optional(),
  }).strict() }).strict(),
  z.object({ op: z.literal('transpose_notes'), track_id: id, start_tick: z.number().int().min(0), end_tick: z.number().int().positive(), semitones: z.number().int().min(-48).max(48) }).strict(),
  z.object({ op: z.literal('set_master_effects'), effects: z.array(plugin).max(16) }).strict(),
  z.object({ op: z.literal('set_sections'), sections: z.array(section).max(256) }).strict(),
  z.object({ op: z.literal('set_harmony'), harmony: z.array(harmony).max(4096) }).strict(),
  z.object({ op: z.literal('set_bpm'), bpm: z.number().min(20).max(300) }).strict(),
]);
export type Project = z.infer<typeof project>;
export type Plugin = z.infer<typeof plugin>;
export type Track = z.infer<typeof track>;
export type Operation = z.infer<typeof operation>;
