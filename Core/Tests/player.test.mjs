import { createLocalApplication } from '../Build/JS/Application/local-application.js';
import { homePaths } from '../Build/JS/Adapters/node/workspace/home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Service} from '../Build/JS/Application/service.js';
import {call} from '../Build/JS/Application/api.js';
import {atomicJson} from '../Build/JS/Adapters/node/workspace/storage.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function project(api,duration='96000'){
 await api('project_create',{project_id:'live',name:'Live',bpm:120,length_ticks:3840,duration_frames:duration,instrument_policy:'allow_basic'});
 await api('project_apply',{project_id:'live',base_revision:0,request_id:'seed',operations:[{op:'add_track',track:{id:'tone',name:'Tone',instrument:{kind:'builtin',sound:'sine'},notes:[{id:'n',tick:0,duration:480,pitch:69,velocity:1}],gain_db:-96}}]});
}
class MockPlayerEngine{
 commands=[];
 async close(){}
 async startPlayback(request,{signal}={}){
  let resolve;const done=new Promise(r=>resolve=r);let state={state:'playing',position_frame:request.start_frame,duration_frames:request.plan.timing.duration_frames,control_sequence:0,output_device:'Mock',effective_mix:{tracks:request.plan.channels.map(t=>({id:t.id,...t.level})),returns:request.plan.returns.map(b=>({id:b.id,mute:b.mute,solo:b.solo,gain_db:b.gain_db,pan:b.pan}))}};
  if(signal?.aborted)resolve({state:'cancelled'});else signal?.addEventListener('abort',()=>resolve({state:'cancelled'}),{once:true});
  return {pid:123,ready:Promise.resolve(state),done,status:async()=>state,close:async()=>resolve({state:'stopped'}),control:async({action,frame,changes})=>{
   this.commands.push(action);
   if(action==='set_mix')for(const change of changes){const item=(change.track_id?state.effective_mix.tracks:state.effective_mix.returns).find(t=>t.id===(change.track_id??change.bus_id));for(const key of ['mute','solo','gain_db','pan'])if(change[key]!==undefined)item[key]=change[key];}
   state={...state,state:action==='pause'?'paused':action==='stop'?'stopped':action==='resume'?'playing':state.state,position_frame:frame??state.position_frame,control_sequence:state.control_sequence+1};if(action==='stop')resolve(state);
  }};
 }

}

test('live player controls a pinned project graph without creating rendered audio',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-player-test-')),engine=new MockPlayerEngine(),service=new Service(root,engine);t.after(()=>service.close());const api=(name,args={})=>call(createLocalApplication(service),name,args);await project(api);
 const started=await api('playback_start',{project_id:'live',loop:true,loop_start_frame:'12000',loop_end_frame:'72000'});for(let i=0;i<200&&(await api('playback_status',{})).state!=='playing';i++)await sleep(5);
 assert.equal(service.processing.status().active.kind,'playback');assert.equal((await api('playback_status',{playback_id:started.playback_id})).revision,1);
 assert.equal((await api('playback_pause',{})).state,'paused');const sought=await api('playback_seek',{frame:'48000'});assert.equal(sought.position_frame,'48000');assert.equal(sought.state,'paused');
 const controls=engine.commands.length;await assert.rejects(api('playback_set_mix',{changes:[{track_id:'missing',mute:true}]}),/Unknown track in pinned/);assert.equal(engine.commands.length,controls);
 const mix=await api('playback_set_mix',{changes:[{track_id:'tone',mute:true,gain_db:-12,pan:0.25}]});assert.equal(mix.state,'paused');assert.equal(mix.effective_mix.tracks[0].mute,true);assert.equal(mix.effective_mix.tracks[0].gain_db,-12);assert.equal(mix.effective_mix.tracks[0].pan,0.25);
 const saved=await service.read('live');assert.equal(saved.revision,1);assert.equal(saved.tracks[0].gain_db,-96);assert.equal(saved.tracks[0].pan,0);
 await assert.rejects(api('playback_set_mix',{changes:[{track_id:'tone',gain_db:13}]}));await assert.rejects(service.setPlaybackMix([{track_id:'tone',pan:NaN}]),/Playback pan/);
 assert.equal((await api('playback_resume',{})).state,'playing');
 const stopped=await api('playback_stop',{});assert.equal(stopped.state,'stopped');assert.equal(stopped.output_device,'Mock');
 await assert.rejects(api('playback_set_mix',{changes:[{track_id:'tone',mute:false}]}),/not ready|ended/);
 const files=await readdir(join(homePaths(root).projects,'live','jobs'),{recursive:true});assert.equal(files.some(name=>String(name).endsWith('.wav')),false);
});

test('native live player reaches the real 48kHz audio device without a WAV render',{skip:process.env.AIDAW_TEST_PLAYBACK!=='1',timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-player-device-')),service=new Service(root);t.after(()=>service.close());const api=(name,args={})=>call(createLocalApplication(service),name,args);
 const instrument=(await api('catalog_scan',{format:'VST3',location:resolve('Core/Build/Native/test-fixtures/aidaw-test-instrument_artefacts/Release/VST3/AIDAW Test Instrument.vst3')})).plugins[0];
 const effect=(await api('catalog_scan',{format:'VST3',location:resolve('Core/Build/Native/test-fixtures/aidaw-test-effect_artefacts/Release/VST3/AIDAW Test Effect.vst3')})).plugins[0];
 const i={kind:'plugin',plugin_id:instrument.plugin_id},fx={kind:'plugin',plugin_id:effect.plugin_id};
 await api('project_create',{project_id:'live',name:'Device graph',bpm:120,length_ticks:480,duration_frames:'12000'});
 await api('project_apply',{project_id:'live',base_revision:0,request_id:'graph',operations:[
  {op:'add_track',track:{id:'tone',name:'Tone',instrument:i,notes:[{id:'n',tick:0,duration:480,pitch:69,velocity:1}],gain_db:-96,effects:[fx],sends:[{bus_id:'room',gain_db:-12}]}},
  {op:'set_buses',buses:[{id:'room',name:'Room',effects:[fx],gain_db:-12}]},{op:'set_master_effects',effects:[fx]}
 ]});
 const started=await api('playback_start',{project_id:'live',tail_seconds:0});let status;
 for(let i=0;i<200;i++){status=await api('playback_status',{playback_id:started.playback_id});if(['completed','failed'].includes(status.state))break;await sleep(25);}
 assert.equal(status.state,'completed',status.error);assert.equal(status.duration_frames,'12000');assert.equal(status.device_buffer_samples%64,0);assert.equal(status.xruns,0);
 const files=await readdir(join(homePaths(root).projects,'live','jobs'),{recursive:true});assert.equal(files.some(name=>String(name).endsWith('.wav')),false);
});
