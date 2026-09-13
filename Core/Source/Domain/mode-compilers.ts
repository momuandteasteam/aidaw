import {project,type Project} from './schema.js';
import type {CompositionDocument,MasteringDocument,GraphSelection} from './domain.js';

export function resolveMasteringTarget(d:MasteringDocument,selection:GraphSelection){
  if(!selection.song_id)throw Error('Mastering playback/render requires song_id');
  if(selection.version_id&&selection.comparison)throw Error('Choose version_id or comparison, not both');
  const song=d.mastering.songs.find(s=>s.id===selection.song_id);if(!song)throw Error('Unknown mastering song');
  const selected=selection.comparison?song.comparison[selection.comparison]:{kind:'version' as const,version_id:selection.version_id??song.current_version_id};
  const version=selected.kind==='version'?song.versions.find(v=>v.id===selected.version_id):song.versions.find(v=>v.source_asset_id===selected.source_asset_id&&(!selected.version_id||v.id===selected.version_id));
  if(!version)throw Error('Unknown mastering version or source');
  return {song,version,selection:selected};
}
export function compileComposition(d:CompositionDocument,selection:GraphSelection={}):Project {
 if(selection.song_id||selection.version_id||selection.comparison)throw Error('Composition has no mastering songs');
 return project.parse({...d.composition,schema_version:2,id:d.id,name:d.name,revision:d.revision,instrument_policy:d.instrument_policy});
}
export function compileMastering(d:MasteringDocument,selection:GraphSelection):Project {
  const {song,version,selection:selected}=resolveMasteringTarget(d,selection);
  // Tempo is an engine conversion detail, never authored mastering state.
  return project.parse({schema_version:2,id:d.id,name:song.name,revision:d.revision,instrument_policy:d.instrument_policy,
    sample_rate:48000,ppq:960,bpm:120,meter:[4,4],length_ticks:1,duration_frames:version.duration_frames,
    tracks:[{id:song.id,name:song.name,instrument:selected.kind==='source'?{...version.clip,fade_in_frames:'0',fade_out_frames:'0'}:version.clip,gain_db:selected.kind==='source'?0:version.input_gain_db,pan:0,notes:[],effects:[]}],
    sections:[],harmony:[],buses:[],master_effects:selected.kind==='source'?[]:version.effects});
}
