import type {AudioPlan,ProcessorReference,SignalSource} from '../../../Contracts/audio-plan.js';
/** This adapter alone translates the portable channel model to JUCE worker fields. */
export async function toJuceGraph(plan:AudioPlan,bind:(p:ProcessorReference)=>Promise<object>){
 const plugins=(list:ProcessorReference[])=>Promise.all(list.map(bind));
 const source=async(s:SignalSource)=>{
  switch(s.type){
   case 'processor':return {instrument:await bind(s.processor)};
   case 'test-tone':return {instrument:{kind:'builtin',sound:s.sound}};
   case 'audio':return {audio_source_path:s.file,audio_clip:s.clip};
   case 'frozen':return {rendered_audio_path:s.file,cached_gain_db:s.gain_db};
  }
 };
 return {schema_version:2,...plan.provenance,...plan.timing,tracks:await Promise.all(plan.channels.map(async c=>({id:c.id,name:c.name,instrument:{kind:c.level.pan_mode==='balance'?'audio':'builtin',sound:'sine'},...await source(c.source),notes:c.events,automation:c.automation,effects:await plugins(c.processors),gain_db:c.level.gain_db,pan:c.level.pan,mute:c.level.mute,solo:c.level.solo,to_master:c.level.to_master,unity_gain:c.level.mode==='unity',sends:c.sends}))),buses:await Promise.all(plan.returns.map(async b=>({id:b.id,name:b.name,effects:await plugins(b.processors),gain_db:b.gain_db,pan:b.pan,mute:b.mute,solo:b.solo}))),master_effects:await plugins(plan.master.processors),master_gain_db:plan.master.gain_db,sections:[],harmony:[]};
}
