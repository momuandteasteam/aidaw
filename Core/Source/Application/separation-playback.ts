/** Two immutable stem sets share one transport and one logical audition mix. */
export interface StemPlayback {engine:string; bindings:Record<string,Record<string,string>>; mix:Array<{track_id:string;mute:boolean;solo:boolean;gain_db:number;pan:number}>}
export function prepareStemPlayback(doc:any,graph:any,overrides?:Array<{track_id:string;mute:boolean;solo:boolean}>):StemPlayback|undefined {
 if(doc.kind!=='separation')return;
 const engine=doc.separation.engine;if(!engine)return;
 const mix=graph.tracks.map((t:any)=>({track_id:t.id,mute:t.mute,solo:t.solo,gain_db:t.gain_db,pan:t.pan,...overrides?.find(o=>o.track_id===t.id)}));
 if(overrides?.some(o=>!mix.some((t:any)=>t.track_id===o.track_id)))throw Error('Unknown audition stem');
 const solo=mix.find((t:any)=>t.solo);for(const t of mix)t.solo=t===solo;
 const bindings:StemPlayback['bindings']={[engine]:Object.fromEntries(graph.tracks.map((t:any)=>[t.id,t.id]))};
 for(const [key,value]of Object.entries(doc.separation.variants??{}) as [string,any][]){
  if(key===engine||value.source_asset_id!==doc.separation.source_asset_id||value.graph.duration_frames!==graph.duration_frames)continue;
  if(value.graph.tracks.length!==mix.length||value.graph.tracks.some((t:any)=>t.instrument.kind!=='audio'||!mix.some((m:any)=>m.track_id===t.id)))continue;
  bindings[key]={};for(const t of value.graph.tracks){const alias=`variant-${key}-${t.id}`;bindings[key][t.id]=alias;graph.tracks.push({...t,id:alias,mute:true,solo:false});}
 }
 const state={engine,bindings,mix};for(const change of stemMixChanges(state))Object.assign(graph.tracks.find((t:any)=>t.id===change.track_id),{mute:change.mute,solo:change.solo,gain_db:change.gain_db,pan:change.pan});return state;
}
export function stemMixChanges(state:StemPlayback){const solo=state.mix.find(t=>t.solo);return Object.entries(state.bindings).flatMap(([engine,ids])=>state.mix.map(t=>({...t,track_id:ids[t.track_id],mute:engine!==state.engine||(solo?t!==solo:t.mute),solo:engine===state.engine&&t===solo})));}
