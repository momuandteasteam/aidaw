import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from './storage.js';
import { layout } from './layout.js';
import { atomicText } from './view-text.js';

async function changedJson(path:string,value:unknown){
 const text=JSON.stringify(value,null,2);
 try{if(await readFile(path,'utf8')===text)return;}catch(e:any){if(e.code!=='ENOENT')throw e;}
 await atomicJson(path,value);
}
/** Derived views have no independent edit authority; project.json + history are authoritative. */
export async function writeProjectViews(dir:string,doc:any){
 const kind=doc.kind??'composition';await layout(dir,kind);
 const common=`# AIDAW作品: ${kind}\n\n作業場所は AIDAW_HOME/Projects/<project_id>/。正本は project.json と state/history。state内の現在ビューは直接編集しない。\n\n作品編集時だけ active_context_get と project_document で対象・正本revisionを確認し、base_revision と一意request_idで確定する。ユーザーの明示対象を優先し、試聴版を編集基点にしない。確定前に選択を再確認するが、選択との原子的照合ではない。\n\n詳細は必要なときだけ読む: [共通編集](../../Workflows/EDITING.md)。\n`;
 const specific=kind==='separation'?`[ステム分離](../../Docs/Contracts/SEPARATION.md): 原音来歴、推定stem、mute/soloとZIP/mix出力。\n`:kind==='mastering'?`[マスタリング手順](../../Workflows/Mastering/MASTERING.md): 曲別の不変版、単一stereo経路、current/accepted/A/Bを区別する。\n`:`[曲制作手順](../../Workflows/Composition/PRODUCTION.md): track、MIDI/audio、instrument/FX、send/return/masterを安定IDで扱う。\n`;
 await atomicText(join(dir,'AGENTS.md'),common+specific);
 if(kind==='mastering'){
  const m=doc.mastering;
  await changedJson(join(dir,'state/mastering/album.json'),{revision:doc.revision,name:doc.name,song_order:m.song_order,songs:m.songs.map((s:any)=>({id:s.id,name:s.name,current_version_id:s.current_version_id,accepted_version_id:s.accepted_version_id,comparison:s.comparison,versions:s.versions.map((v:any)=>({id:v.id,label:v.label,parent_version_id:v.parent_version_id,created_revision:v.created_revision}))}))});
  for(const song of m.songs){
   const version=song.versions.find((v:any)=>v.id===song.current_version_id);
   await changedJson(join(dir,'state/mastering/songs',song.id,'source.json'),{asset_id:version.source_asset_id,sha256:version.source_sha256,clip:version.clip,duration_frames:version.duration_frames});
   await changedJson(join(dir,'state/mastering/songs',song.id,'chain.json'),{version_id:version.id,input_gain_db:version.input_gain_db,effects:version.effects,tail_seconds:version.tail_seconds});
  }
 }else{
  const p=doc.composition??doc;
  if(kind==='separation')await changedJson(join(dir,'state/separation/source.json'),doc.separation);
  await changedJson(join(dir,'state/composition/arrangement.json'),{revision:doc.revision,bpm:p.bpm,meter:p.meter,length_ticks:p.length_ticks,duration_frames:p.duration_frames,track_order:p.tracks.map((t:any)=>t.id),sections:p.sections,harmony:p.harmony});
  await changedJson(join(dir,'state/composition/mixer.json'),{revision:doc.revision,channels:p.tracks.map((t:any)=>({id:t.id,gain_db:t.gain_db,pan:t.pan,mute:t.mute,solo:t.solo,to_master:t.to_master,sends:t.sends})),returns:p.buses,master:{effects:p.master_effects}});
  for(const track of p.tracks){
   const {notes,automation,instrument,effects,id,name,role}=track;
   await changedJson(join(dir,'state/composition/tracks',id,'track.json'),{id,name,role,instrument,effects});
   await changedJson(join(dir,'state/composition/tracks',id,'performance.json'),instrument.kind==='audio'?{kind:'audio',clip:instrument}:{kind:'midi',notes,automation});
  }
 }
 await changedJson(join(dir,'state/view-revision.json'),{revision:doc.revision,kind});
}
