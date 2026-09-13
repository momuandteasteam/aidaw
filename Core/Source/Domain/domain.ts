import {compileComposition,compileMastering} from './mode-compilers.js';
import { z } from 'zod';
import { id, frame, audioInstrument, plugin, project, operation, type Project } from './schema.js';

/** The document is the authored work; a native graph represents only one audition. */
const { schema_version: _schema, id: _id, name: _name, revision: _revision,
  instrument_policy: _policy, ...graphShape } = project.shape;
export const compositionGraph = z.object(graphShape).strict();
const base = {schema_version:z.literal(3),id,name:z.string().min(1).max(200),revision:z.number().int().nonnegative(),instrument_policy:z.enum(['plugin_first','allow_basic']).default('plugin_first')};
export const versionSelection = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('version'),version_id:id}).strict(),
  z.object({kind:z.literal('source'),source_asset_id:z.string().min(1),version_id:id.optional()}).strict(),
]);
export const masteringVersion = z.object({
  id,label:z.string().min(1).max(200),parent_version_id:id.optional(),
  created_at:z.string().datetime(),created_revision:z.number().int().nonnegative(),
  source_asset_id:z.string().min(1),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  clip:audioInstrument,duration_frames:frame,tail_seconds:z.number().min(0).max(30).default(0),
  input_gain_db:z.number().min(-96).max(12).default(0),effects:z.array(plugin).max(16).default([]),
}).strict().superRefine((v,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(v.source_asset_id!==v.clip.asset_id)fail('Version source and clip asset must match');
  if(BigInt(v.duration_frames)===0n)fail('Version duration must be positive');
  if(BigInt(v.duration_frames)+BigInt(Math.round(v.tail_seconds*48000))>86400000n)fail('Version plus tail exceeds 30 minutes');
  if(v.clip.end_frame!==undefined){
    const span=BigInt(v.clip.end_frame)-BigInt(v.clip.start_frame);
    if(span<=0n)fail('Invalid version clip range');
    if(BigInt(v.clip.timeline_frame)+span>BigInt(v.duration_frames))fail('Version duration would truncate source');
    if(BigInt(v.clip.fade_in_frames)+BigInt(v.clip.fade_out_frames)>span)fail('Version fades exceed clip');
  }
});
export const masteringSong = z.object({
  id,name:z.string().min(1).max(200),versions:z.array(masteringVersion).min(1),
  current_version_id:id,accepted_version_id:id.optional(),
  comparison:z.object({a:versionSelection,b:versionSelection}).strict(),
}).strict().superRefine((s,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  const versions=new Map(s.versions.map(v=>[v.id,v]));
  if(versions.size!==s.versions.length)fail('Duplicate version IDs');
  for(const v of s.versions){
    if(v.parent_version_id&&(!versions.has(v.parent_version_id)||v.parent_version_id===v.id))fail('Unknown or self parent version');
    const seen=new Set<string>();let cursor:typeof v|undefined=v;
    while(cursor){if(seen.has(cursor.id)){fail('Cyclic version ancestry');break;}seen.add(cursor.id);cursor=cursor.parent_version_id?versions.get(cursor.parent_version_id):undefined;}
  }
  for(const ref of [s.current_version_id,s.accepted_version_id].filter(Boolean))if(!versions.has(ref!))fail('Unknown current or accepted version');
  for(const selection of [s.comparison.a,s.comparison.b]){
    if(selection.kind==='version'&&!versions.has(selection.version_id))fail('Comparison version belongs to another song or is unknown');
    if(selection.kind==='source'&&!s.versions.some(v=>v.source_asset_id===selection.source_asset_id))fail('Comparison source is not a source of this song');
    if(selection.kind==='source'&&selection.version_id&&versions.get(selection.version_id)?.source_asset_id!==selection.source_asset_id)fail('Source comparison anchor must belong to this song and source');
  }
});
export const compositionDocument = z.object({...base,kind:z.literal('composition'),composition:compositionGraph}).strict().superRefine((d,ctx)=>{
  const result=project.safeParse({...d.composition,schema_version:2,id:d.id,name:d.name,revision:d.revision,instrument_policy:d.instrument_policy});
  if(!result.success)for(const issue of result.error.issues)ctx.addIssue({...issue,path:['composition',...issue.path]});
});
export const masteringDocument = z.object({...base,kind:z.literal('mastering'),mastering:z.object({song_order:z.array(id),songs:z.array(masteringSong)}).strict()}).strict().superRefine((d,ctx)=>{
  const {song_order,songs}=d.mastering;
  if(new Set(songs.map(s=>s.id)).size!==songs.length)ctx.addIssue({code:'custom',message:'Duplicate song IDs'});
  if(new Set(song_order).size!==song_order.length||song_order.length!==songs.length||song_order.some(s=>!songs.some(x=>x.id===s)))ctx.addIssue({code:'custom',message:'Song order must contain each song exactly once'});
});
export const separationState=z.object({source_asset_id:z.string().optional(),engine:z.string().optional(),model:z.string().optional(),job_id:id.optional()}).strict();
export const separationDocument=z.object({...base,kind:z.literal('separation'),composition:compositionGraph,separation:separationState.default({})}).strict().superRefine((d,ctx)=>{
 const graph=project.safeParse({...d.composition,schema_version:2,id:d.id,name:d.name,revision:d.revision,instrument_policy:d.instrument_policy});
 if(!graph.success)for(const issue of graph.error.issues)ctx.addIssue({...issue,path:['composition',...issue.path]});
 if(d.composition.buses.length||d.composition.master_effects.length||d.composition.tracks.some(t=>t.instrument.kind!=='audio'||t.pan!==0||t.effects.length||t.sends.length||!t.to_master||t.notes.length||(t.instrument.kind==='audio'&&(t.instrument.start_frame!=='0'||t.instrument.timeline_frame!=='0'||t.instrument.fade_in_frames!=='0'||t.instrument.fade_out_frames!=='0'||t.instrument.end_frame!==d.composition.duration_frames))))ctx.addIssue({code:'custom',message:'Separation requires full-length audio stems without FX, sends or pan'});
});
export const document=z.union([compositionDocument,masteringDocument,separationDocument,project]);
export type Document=z.infer<typeof document>;
export type CompositionDocument=z.infer<typeof compositionDocument>;
export type MasteringDocument=z.infer<typeof masteringDocument>;
export type MasteringVersion=z.infer<typeof masteringVersion>;
export type GraphSelection={song_id?:string;version_id?:string;comparison?:'a'|'b'};
export function parseDocument(value:unknown):Document{return document.parse(value);}
export function compositionFromGraph(value:Project):CompositionDocument{
  const {id,name,revision,instrument_policy,schema_version,...composition}=project.parse(value);
  return compositionDocument.parse({schema_version:3,kind:'composition',id,name,revision,instrument_policy,composition});
}
export {resolveMasteringTarget,compileComposition,compileMastering} from './mode-compilers.js';
export function compileDocument(d:Document,selection:GraphSelection={}):Project {
 if(d.schema_version!==3){if(selection.song_id||selection.version_id||selection.comparison)throw Error('Legacy project has no mastering songs');return d;}
 return d.kind==='mastering'?compileMastering(d,selection):compileComposition({...d,kind:'composition'},selection);
}
export const masteringOperation=z.discriminatedUnion('op',[
  z.object({op:z.literal('add_song'),song:masteringSong}).strict(),
  z.object({op:z.literal('remove_song'),song_id:id}).strict(),
  z.object({op:z.literal('set_song_order'),song_ids:z.array(id)}).strict(),
  z.object({op:z.literal('add_version'),song_id:id,version:masteringVersion}).strict(),
  z.object({op:z.literal('set_current_version'),song_id:id,version_id:id}).strict(),
  z.object({op:z.literal('set_accepted_version'),song_id:id,version_id:id}).strict(),
  z.object({op:z.literal('set_comparison'),song_id:id,slot:z.enum(['a','b']),selection:versionSelection}).strict(),
  z.object({op:z.literal('rename_song'),song_id:id,name:z.string().min(1).max(200)}).strict(),
]);
export const separationOperation=z.object({op:z.literal('set_separation'),state:separationState}).strict();
export const domainOperation=z.union([operation,masteringOperation,separationOperation]);
export type DomainOperation=z.infer<typeof domainOperation>;
export function applyDocumentOperations(value:Document,inputs:DomainOperation[]):Document{
  const doc=parseDocument(value);const ops=inputs.map(op=>domainOperation.parse(op));
  if(doc.schema_version===3&&doc.kind==='mastering'){
    for(const input of ops){
      const checked=masteringOperation.safeParse(input);if(!checked.success)throw Error('Composition operation cannot edit a mastering album');const op=checked.data;
      if(op.op==='add_song'){doc.mastering.songs.push(op.song);doc.mastering.song_order.push(op.song.id);continue;}
      if(op.op==='set_song_order'){doc.mastering.song_order=op.song_ids;continue;}
      const song=doc.mastering.songs.find(s=>s.id===op.song_id);if(!song)throw Error('Unknown mastering song');
      switch(op.op){
        case 'remove_song':doc.mastering.songs=doc.mastering.songs.filter(s=>s.id!==song.id);doc.mastering.song_order=doc.mastering.song_order.filter(id=>id!==song.id);break;
        case 'add_version':if(song.versions.some(v=>v.id===op.version.id))throw Error('Mastering versions are immutable; use a new version ID');song.versions.push(op.version);song.current_version_id=op.version.id;break;
        case 'set_current_version':song.current_version_id=op.version_id;break;
        case 'set_accepted_version':song.accepted_version_id=op.version_id;break;
        case 'set_comparison':song.comparison[op.slot]=op.selection;break;
        case 'rename_song':song.name=op.name;break;
      }
    }
    return parseDocument(doc);
  }
  const p=compileDocument(doc);
  for(const input of ops){
    if(input.op==='set_separation'){if(doc.schema_version!==3||doc.kind!=='separation')throw Error('Not a separation project');doc.separation=input.state;continue;}
    const checked=operation.safeParse(input);if(!checked.success)throw Error('Mastering operation cannot edit a composition');const op=checked.data;
    const t='track_id'in op?p.tracks.find(t=>t.id===op.track_id):undefined;
    if('track_id'in op&&!t)throw Error('Unknown track');
    switch(op.op){
      case 'set_timing':p.length_ticks=op.length_ticks;p.meter=op.meter;break;
      case 'set_bus':{const b=p.buses.find(b=>b.id===op.bus_id);if(!b)throw Error('Unknown bus');Object.assign(b,op.changes);break;}
      case 'set_buses':p.buses=op.buses;break;
      case 'set_duration_frames':p.duration_frames=op.duration_frames;break;
      case 'edit_audio_clip':if(t!.instrument.kind!=='audio')throw Error('Not an audio clip');Object.assign(t!.instrument,op.changes);if(op.changes.end_frame===null)delete t!.instrument.end_frame;break;
      case 'add_track':p.tracks.push(op.track);break;
      case 'remove_track':p.tracks=p.tracks.filter(t=>t.id!==op.track_id);break;
      case 'replace_notes':t!.notes=op.notes;break;
      case 'set_track':Object.assign(t!,op.changes);break;
      case 'transpose_notes':if(op.end_tick<=op.start_tick)throw Error('Invalid transpose range');for(const n of t!.notes)if(n.tick>=op.start_tick&&n.tick<op.end_tick)n.pitch+=op.semitones;break;
      case 'set_master_effects':p.master_effects=op.effects;break;
      case 'set_sections':p.sections=op.sections;break;
      case 'set_harmony':p.harmony=op.harmony;break;
      case 'set_bpm':p.bpm=op.bpm;break;
    }
  }
  return doc.schema_version===3?(doc.kind==='separation'?separationDocument.parse({...doc,composition:compositionFromGraph(p).composition}):compositionFromGraph(p)):project.parse(p);
}
