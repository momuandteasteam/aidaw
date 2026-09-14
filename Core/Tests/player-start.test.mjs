import { homePaths } from '../Build/JS/Adapters/node/workspace/home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../Build/JS/Application/service.js';
import {parseDocument,compositionFromGraph} from '../Build/JS/Domain/domain.js';
import {project} from '../Build/JS/Domain/schema.js';
import {atomicJson} from '../Build/JS/Adapters/node/workspace/storage.js';
import {initializeHistory} from '../Build/JS/Adapters/node/workspace/history.js';

const args={project_id:'work',start_frame:'0',tail_seconds:0,loop:false,loop_start_frame:'0',loop_end_frame:'0'};
const composition=()=>compositionFromGraph(project.parse({schema_version:2,id:'work',name:'曲',revision:1,instrument_policy:'allow_basic',sample_rate:48000,ppq:960,bpm:120,meter:[4,4],length_ticks:960,duration_frames:'24000',tracks:[{id:'tone',name:'Tone',instrument:{kind:'builtin',sound:'sine'},notes:[]}],sections:[],harmony:[],master_effects:[]}));
const album=()=>parseDocument({schema_version:3,kind:'mastering',id:'work',name:'Album',revision:4,mastering:{song_order:['song'],songs:[{id:'song',name:'Song',current_version_id:'v2',comparison:{a:{kind:'version',version_id:'v1'},b:{kind:'source',source_asset_id:'source',version_id:'v2'}},versions:['v1','v2'].map((id,i)=>({id,label:id,created_at:'2026-09-14T00:00:00.000Z',created_revision:i+1,source_asset_id:'source',source_sha256:'a'.repeat(64),clip:{kind:'audio',asset_id:'source',start_frame:'0',end_frame:'24000',fade_in_frames:i?'1000':'0'},duration_frames:'24000',tail_seconds:i?0.75:0.25,input_gain_db:i?-6:0,effects:[]}))}]}});
class MockEngine{
 requests=[];
 async describe(){return {features:[]};}
 async close(){}
 async startPlayback(request,{signal}){
  this.requests.push(request);let finish;
  const done=new Promise(resolve=>{finish=resolve;});let state={state:'playing',position_frame:'0',control_sequence:0,effective_mix:{tracks:request.plan.channels.map(t=>({id:t.id,...t.level})),returns:[]}};

  if(signal.aborted)finish({state:'cancelled'});else signal.addEventListener('abort',()=>finish({state:'cancelled'}),{once:true});
  return {ready:Promise.resolve(state),done,status:async()=>state,close:async()=>finish({state:'stopped'}),control:async({action,changes})=>{if(action==='set_mix')for(const change of changes){const track=state.effective_mix.tracks.find(t=>t.id===change.track_id);if(change.gain_db!==undefined)track.gain_db=change.gain_db;}state={...state,state:action==='stop'?'stopped':action==='pause'?'paused':action==='resume'?'playing':state.state,control_sequence:state.control_sequence+1};if(action==='stop')finish(state);}};
 }
}
async function setup(t){const root=await mkdtemp(join(tmpdir(),'aidaw-start-')),engine=new MockEngine(),service=new Service(root,engine);service.resolvedProject=async p=>({...p,tracks:p.tracks.map(t=>t.instrument.kind==='audio'?{...t,audio_source_path:'/test-source.wav',audio_clip:t.instrument}:t)});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});return {root,engine,service};}
async function ready(service,id){for(let i=0;i<100;i++){const state=await service.playbackStatus(id);if(state.state==='playing')return state;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Mock player did not start');}

test('concurrent starts reserve one session before document loading and stop reaches that worker',async t=>{
 const {service,engine}=await setup(t);let release,entered;
 const gate=new Promise(resolve=>{release=resolve;}),reading=new Promise(resolve=>{entered=resolve;});
 service.readDocument=async()=>{entered();await gate;return composition();};
 const first=service.startPlayback(args);await reading;
 await assert.rejects(service.startPlayback(args),/already starting/);release();
 const start=await first;await ready(service,start.playback_id);assert.equal(engine.requests.length,1);
 const stop=await service.controlPlayback('stop',undefined,start.playback_id);assert.equal(stop.state,'stopped');
 assert.equal(service.processing.status().active,null);
});
test('a failed start releases its reservation for retry',async t=>{
 const {service,engine}=await setup(t);let calls=0;
 service.readDocument=async()=>{if(++calls===1)throw Error('Temporary load failure');return composition();};
 await assert.rejects(service.startPlayback(args),/Temporary load failure/);
 const start=await service.startPlayback(args);await ready(service,start.playback_id);assert.equal(engine.requests.length,1);
});
test('mastering playback pins A/B version, source and mode from one document read',async t=>{
 const {service,engine,root}=await setup(t);let reads=0;
 service.readDocument=async()=>{reads++;return reads===1?album():composition();};
 const start=await service.startPlayback({...args,tail_seconds:undefined,song_id:'song',comparison:'a'});await ready(service,start.playback_id);
 assert.equal(reads,1);assert.equal(start.tail_seconds,0.25);assert.equal(engine.requests[0].tail_seconds,0.25);assert.equal(start.revision,4);assert.equal(start.version_id,'v1');assert.equal(start.selection.kind,'version');assert.equal(start.source_asset_id,'source');assert.equal(engine.requests[0].plan.channels[0].level.gain_db,0);
 assert.equal((await service.playbackStatus()).version_id,'v1');
 await assert.rejects(service.setPlaybackMix([{track_id:'song',mute:true}],start.playback_id),/composition playback/);
 await assert.rejects(service.setPlaybackMix([{track_id:'song',gain_db:-3,pan:0.25}],start.playback_id),/only input gain_db/);
 await assert.rejects(service.setPlaybackMix([{bus_id:'song',gain_db:-3}],start.playback_id),/only input gain_db/);
 await assert.rejects(service.setPlaybackMix([{track_id:'wrong_song',gain_db:-3}],start.playback_id),/Unknown track/);
 await service.controlPlayback('pause',undefined,start.playback_id);
 const adjusted=await service.setPlaybackMix([{track_id:'song',gain_db:-3}],start.playback_id);assert.equal(adjusted.state,'paused');assert.equal(adjusted.effective_mix.tracks[0].gain_db,-3);assert.equal(adjusted.revision,4);assert.equal(engine.requests[0].plan.channels[0].level.gain_db,0);
 const request=JSON.parse(await readFile(join(homePaths(root).projects,'work','jobs',start.playback_id,'request.json'),'utf8'));assert.equal(request.project_kind,'mastering');assert.equal(request.version_id,'v1');
});
test('historical source audition records its anchor without reading the current document',async t=>{
 const {service,engine}=await setup(t);const doc=album(),dir=service.dir('work');
 const history=await initializeHistory(dir,doc);await atomicJson(join(dir,'project.json'),{project:doc,history,receipts:{}});
 service.readDocument=async()=>{throw Error('Historical playback must not read the latest document through Service');};
 const start=await service.startPlayback({...args,tail_seconds:undefined,revision:4,song_id:'song',comparison:'b'});await ready(service,start.playback_id);
 assert.equal(start.tail_seconds,0);assert.equal(engine.requests[0].tail_seconds,0);assert.equal(start.version_id,'v2');assert.equal(start.selection.kind,'source');assert.equal(start.selection.version_id,'v2');assert.equal(start.source_asset_id,'source');
 assert.equal(engine.requests[0].plan.channels[0].level.gain_db,0);assert.equal(engine.requests[0].plan.channels[0].source.clip.fade_in_frames,'0');
});
