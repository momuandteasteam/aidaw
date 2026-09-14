import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../Build/JS/Application/service.js';
import {createLocalApplication} from '../Build/JS/Application/local-application.js';
import {call} from '../Build/JS/Application/api.js';
class Player {
 starts=[];fail=false;
 async analyze(){return {sample_rate:48000,frames:480000,channels:2};}
 async describe(){return {features:['playback.initial_pause.v1','playback.position_switch.v1']};}
 async close(){}
 async startPlayback(args){
  if(this.fail)throw Error('load failed');this.starts.push(args);let finish;
  let state={state:args.start_paused?'paused':'playing',position_frame:args.start_frame,duration_frames:'480000',monitor_gain_db:args.monitor_gain_db};
  const done=new Promise(r=>finish=r);
  return {ready:Promise.resolve(state),done,status:async()=>state,close:async()=>finish({state:'stopped'}),control:async c=>{
   if(c.action==='stop'){if(this.stopError)throw Error('stop failed');await this.onStop?.();state={...state,state:'stopped',position_frame:String(Number(state.position_frame)+64)};finish(state);}else if(c.action==='pause')state={...state,state:'paused'};else if(c.action==='resume')state={...state,state:'playing'};
  }};
 }
}
async function setup(t,two=true){const root=await mkdtemp(join(tmpdir(),'aidaw-ab-')),engine=new Player(),service=new Service(root,engine),app=createLocalApplication(service),api=(name,args={})=>call(app,name,args);t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 await api('project_create',{project_id:'album',kind:'mastering',name:'Album'});await writeFile(join(root,'source.wav'),'fixture');const asset=await api('asset_import',{project_id:'album',path:join(root,'source.wav'),role:'source'});
 await api('mastering_add_song',{project_id:'album',base_revision:0,request_id:'original',song_id:'song',name:'Song',asset_id:asset.id});
 if(two)await api('mastering_create_version',{project_id:'album',base_revision:1,request_id:'quiet',song_id:'song',parent_version_id:'original',label:'Quiet',input_gain_db:-6});
 return {api,service,engine};
}
const base={project_id:'album',song_id:'song'};
async function ready(api,id){for(let i=0;i<1000;i++){const s=await api('playback_status',{playback_id:id});if(['playing','paused'].includes(s.state))return s;if(['failed','cancelled'].includes(s.state))throw Error(s.error??s.state);await new Promise(r=>setTimeout(r,5));}throw Error('not ready');}
test('cycle is metadata-only, wraps, replays once, and can commit while the audio lane is occupied',{timeout:10000},async t=>{
 const {api}=await setup(t);const p=await api('playback_start',{...base,comparison:'a',start_frame:'96000'});await ready(api,p.playback_id);
 const a={...base,slot:'b',base_revision:2,request_id:'cycle'};assert.equal((await api('mastering_comparison_cycle',a)).selection.version_id,'quiet');assert.equal((await api('mastering_comparison_cycle',a)).replayed,true);
 assert.equal((await api('playback_status',{playback_id:p.playback_id})).state,'playing');
 assert.equal((await api('mastering_comparison_cycle',{...a,base_revision:3,request_id:'wrap'})).selection.version_id,'original');
 const d=await api('project_document',{project_id:'album'});assert.equal(d.mastering.songs[0].current_version_id,'quiet');assert.equal(d.mastering.songs[0].versions.length,2);
});
test('switch uses acknowledged engine frame and preserves paused state and monitor volume',{timeout:10000},async t=>{
 const {api,engine}=await setup(t);let p=await api('playback_start',{...base,comparison:'a',start_frame:'96000',monitor_gain_db:-15});await ready(api,p.playback_id);
 p=await api('playback_switch_mastering',{...base,playback_id:p.playback_id,comparison:'b',revision:2});assert.equal(p.start_frame,'96064');assert.equal(p.comparison,'b');assert.equal(engine.starts.at(-1).monitor_gain_db,-15);
 await api('playback_pause',{playback_id:p.playback_id});p=await api('playback_switch_mastering',{...base,playback_id:p.playback_id,comparison:'a',revision:2});assert.equal(p.state,'paused');assert.equal(p.start_frame,'96128');assert.equal(engine.starts.at(-1).start_paused,true);
});
test('invalid targets leave playback intact and failed loads are reported without fallback',{timeout:10000},async t=>{
 const {api,engine}=await setup(t);let p=await api('playback_start',{...base,comparison:'a'});await ready(api,p.playback_id);
 await assert.rejects(api('playback_switch_mastering',{...base,song_id:'wrong',playback_id:p.playback_id,comparison:'b',revision:2}),/mismatch/);assert.equal((await api('playback_status')).state,'playing');
 engine.fail=true;await assert.rejects(api('playback_switch_mastering',{...base,playback_id:p.playback_id,comparison:'b',revision:2}),/load failed/i);assert.equal((await api('playback_status')).state,'failed');assert.equal(engine.starts.length,1);
});
import {createControlRuntime} from '../Source/Desktop/runtime/control-runtime.mjs';
import {createSurfaceSnapshot} from '../Source/ControlSurface/surface-contract.mjs';
import {createDeckState} from '../Source/ControlSurface/model.mjs';
const uiDoc={kind:'mastering',revision:2,mastering:{song_order:['song'],songs:[{id:'song',name:'Song',current_version_id:'quiet',versions:[{id:'original',label:'Original',duration_frames:'480000',input_gain_db:0},{id:'quiet',label:'Quiet',duration_frames:'480000',input_gain_db:-6}],comparison:{a:{kind:'version',version_id:'original'},b:{kind:'version',version_id:'quiet'}}}]}};
test('second row order and selected state are shared by desktop and hardware snapshots',()=>{
 for(const slot of [null,'A','B']){const s=createSurfaceSnapshot({...createDeckState(),projectId:'album',songId:'song',document:uiDoc,activeSlot:slot});const row=s.keys.filter(k=>k.row===1).sort((a,b)=>a.column-b.column);assert.deepEqual(row.slice(0,4).map(k=>k.label),['Aを選択','Bを選択','音を切替','次の曲']);assert.equal(row[0].pressed,slot==='A');assert.equal(row[1].pressed,slot==='B');if(slot){const chosen=row[slot==='A'?0:1];assert.equal(chosen.secondary,'選択中');assert.match(chosen.svg,/<circle cx="8" cy="8"/);assert.doesNotMatch(chosen.svg,/font-size="5.5"/);}}
});
test('stopped selection does not play, next play uses the slot, and switch highlight waits for engine result',async()=>{
 const calls=[];let complete;
 const runtime=createControlRuntime({application:{async invoke(name,args){calls.push({name,args});if(name==='playback_start')return {...args,playback_id:'first',state:'playing',version_id:'original'};if(name==='playback_switch_mastering')return new Promise(r=>complete=r);return {};}},host:{clearMessage(){},outputDevice:()=>''},onError:e=>{throw e;}});
 try{runtime.patch({projectId:'album',songId:'song',document:uiDoc,position:'96000'});await runtime.dispatch({type:'switchA'});assert.equal(calls.length,0);assert.equal(runtime.getState().activeSlot,'A');await runtime.dispatch({type:'play'});assert.equal(calls.at(-1).args.comparison,'a');assert.equal(calls.at(-1).args.version_id,undefined);
 const switching=runtime.dispatch({type:'switchB'});await new Promise(r=>setTimeout(r,0));assert.equal(runtime.getState().activeSlot,'A');complete({playback_id:'second',project_id:'album',song_id:'song',state:'playing',version_id:'quiet',comparison:'b',position_frame:'96128'});await switching;assert.equal(runtime.getState().activeSlot,'B');assert.equal(runtime.getState().position,'96128');
 }finally{runtime.dispose();}
});
test('meter records are keyed to the heard song and version, with unmeasured targets left empty',()=>{
 const runtime=createControlRuntime({application:{invoke:async()=>({})},host:{},onError:()=>{}});
 try{runtime.patch({projectId:'album',songId:'song',document:uiDoc});runtime.patch({playback:{playback_id:'p',project_id:'album',song_id:'song',selection:{kind:'version',version_id:'original'},state:'playing',comparison_meter:{available:true,rms:.1,sample_peak:.2}}});const s=runtime.snapshot();assert.equal(s.comparisons[0].meter.rms,.1);assert.equal(s.comparisons[1].meter,null);}finally{runtime.dispose();}
});

test('single-version rotation is a no-op and source rotation loads the first version',async t=>{
 const {api}=await setup(t,false);const a={...base,slot:'a',base_revision:1,request_id:'one'};assert.equal((await api('mastering_comparison_cycle',a)).unchanged,true);assert.equal((await api('project_document',{project_id:'album'})).revision,1);
 const doc=await api('project_document',{project_id:'album'}),v=doc.mastering.songs[0].versions[0];await api('project_apply',{project_id:'album',base_revision:1,request_id:'source',operations:[{op:'set_comparison',song_id:'song',slot:'a',selection:{kind:'source',source_asset_id:v.source_asset_id,version_id:v.id}}]});assert.equal((await api('mastering_comparison_cycle',{...a,base_revision:2,request_id:'from-source'})).selection.version_id,'original');
});
test('stop cancels an in-flight switch and concurrent switches never start competing sessions',{timeout:10000},async t=>{
 const {api,engine}=await setup(t);const p=await api('playback_start',{...base,comparison:'a'});await ready(api,p.playback_id);
 let release,entered;const hold=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);engine.onStop=async()=>{entered();await hold;};
 const args={...base,playback_id:p.playback_id,comparison:'b',revision:2};const switching=api('playback_switch_mastering',args);const rejected=assert.rejects(switching,/cancelled/);await waiting;
 await assert.rejects(api('playback_switch_mastering',args),/in progress/);const stopping=api('playback_stop',{playback_id:p.playback_id});release();await stopping;await rejected;assert.equal(engine.starts.length,1);assert.equal((await api('playback_status')).state,'stopped');
});
test('stop failure does not start a replacement session',{timeout:10000},async t=>{
 const {api,engine}=await setup(t);const p=await api('playback_start',{...base,comparison:'a'});await ready(api,p.playback_id);engine.stopError=true;
 try{await assert.rejects(api('playback_switch_mastering',{...base,playback_id:p.playback_id,comparison:'b',revision:2}),/stop failed/);assert.equal(engine.starts.length,1);assert.equal((await api('playback_status')).state,'playing');}finally{engine.stopError=false;}
});
import {Engine} from '../Build/JS/Adapters/node/engine/engine.js';
import {resolve} from 'node:path';
test('real engine preserves the exact paused frame across A/B with muted output',{skip:process.env.AIDAW_TEST_PLAYBACK!=='1',timeout:30000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-ab-device-')),engine=new Engine(resolve('Core/Build/Native/bin/aidaw-engine'),{home:process.cwd()}),service=new Service(root,engine),application=createLocalApplication(service),api=(n,a={})=>call(application,n,a);t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 let renders=0;const render=engine.render.bind(engine);engine.render=async(...args)=>{renders++;return render(...args);};
 const frames=240000,wav=Buffer.alloc(44+frames*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(192000,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){const v=Math.round(4000*Math.sin(i*2*Math.PI*440/48000));wav.writeInt16LE(v,44+i*4);wav.writeInt16LE(v,46+i*4);}await writeFile(join(root,'tone.wav'),wav);
 await api('project_create',{project_id:'album',kind:'mastering',name:'Muted comparison test'});const asset=await api('asset_import',{project_id:'album',path:join(root,'tone.wav'),role:'source'});await api('mastering_add_song',{...base,base_revision:0,request_id:'original',name:'Tone',asset_id:asset.id});await api('mastering_create_version',{...base,base_revision:1,request_id:'quiet',parent_version_id:'original',label:'Quiet',input_gain_db:-6});await api('mastering_comparison_cycle',{...base,slot:'b',base_revision:2,request_id:'b'});
 let p=await api('playback_start',{...base,comparison:'a',monitor_gain_db:-96});const sessionId=p.playback_id;const started=await ready(api,p.playback_id);assert.equal(started.prepared_comparison,true);await new Promise(r=>setTimeout(r,100));const switchAt=performance.now();p=await api('playback_switch_mastering',{...base,playback_id:p.playback_id,comparison:'b',revision:3});t.diagnostic(`Prepared A/B API latency: ${(performance.now()-switchAt).toFixed(1)} ms`);assert.equal(p.playback_id,sessionId);assert.equal(p.version_id,'quiet');assert.equal(p.state,'playing');assert.equal(p.monitor_gain_db,-96);
 const paused=await api('playback_pause',{playback_id:p.playback_id});p=await api('playback_switch_mastering',{...base,playback_id:p.playback_id,comparison:'a',revision:3});assert.equal(p.state,'paused');assert.equal(p.position_frame,paused.position_frame);assert.equal(p.version_id,'original');assert.equal(p.monitor_gain_db,-96);const a=await api('project_waveform',{...base,comparison:'a'}),b=await api('project_waveform',{...base,comparison:'b'});assert.equal(a.role,'processed_mix');assert.equal(b.role,'processed_mix');assert.ok(Math.max(...b.peaks)<Math.max(...a.peaks)*.51);await api('playback_stop',{playback_id:p.playback_id});const rendered=renders;await api('mastering_comparison_cycle',{...base,slot:'a',base_revision:3,request_id:'metadata-only'});const again=await api('playback_start',{...base,comparison:'a',monitor_gain_db:-96});await ready(api,again.playback_id);assert.equal(renders,rendered,'comparison reassignment across revisions must reuse rendered audio');t.diagnostic(`Same-session A/B paused frame: ${p.position_frame}; processed waveforms differ; cache reused`);
});
for(const sameSession of [false,true])test(`a stale status error after an A/B switch is ignored (same session: ${sameSession})`,{timeout:5000},async()=>{
 const errors=[];let failOld,started;const polling=new Promise(r=>started=r);
 const runtime=createControlRuntime({application:{async bootstrap(){return {api:[],projects:[{project_id:'album'}]};},async invoke(name,args){if(name==='project_document')return uiDoc;if(name==='project_list')return [{project_id:'album'}];if(name==='playback_status'){if(args.playback_id==='old'){started();return new Promise((resolve,reject)=>failOld=reject);}return {playback_id:'new',project_id:'album',song_id:'song',state:'paused'};}if(name==='playback_switch_mastering')return {playback_id:sameSession?'old':'new',project_id:'album',song_id:'song',state:'paused',comparison:'b',version_id:'quiet',selection:{kind:'version',version_id:'quiet'},position_frame:'12345'};return {}; }},host:{preferences:async()=>({project_id:'album'}),configure:async()=>{},clearMessage(){}},onError:e=>errors.push(e)});
 try{await runtime.start();runtime.patch({songId:'song',activeSlot:'A',playback:{playback_id:'old',project_id:'album',song_id:'song',state:'paused',selection:{kind:'version',version_id:'original'},version_id:'original'}});await polling;await runtime.dispatch({type:'switchB'});failOld(Error('Playback session not found'));await new Promise(r=>setTimeout(r,10));assert.equal(runtime.getState().activeSlot,'B');assert.deepEqual(errors,[]);}finally{runtime.dispose();}
});
