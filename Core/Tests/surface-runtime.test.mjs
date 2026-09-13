import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlRuntime} from '../Source/Desktop/runtime/control-runtime.mjs';
import {createSkinRegistry,createSkinHost} from '../../Plugins/Skins/index.mjs';
const doc={schema_version:3,id:'song',kind:'composition',revision:4,name:'Song',composition:{bpm:120,ppq:960,length_ticks:3840,tracks:[],buses:[],master_effects:[]}};
function fixture(){const calls=[],errors=[];const runtime=createControlRuntime({application:{async invoke(name,args){calls.push({name,args});return {playback_id:'live',project_id:'song',state:'playing'};}},host:{outputDevice:()=>'',clearMessage(){},openSettings(){}},onError:e=>errors.push(e)});runtime.patch({document:doc,projectId:'song',position:'100',playback:{playback_id:'live',project_id:'song',state:'playing',duration_frames:'192000',sample_rate:48000}});return {runtime,calls,errors};}
test('surface actions are validated and snapshots exclude mutable project and plugin state',async()=>{const {runtime,calls}=fixture();try{const s=runtime.snapshot();assert.equal(s.contractVersion,1);assert.equal(s.transport.id,'live');assert.ok(Object.isFrozen(s.keys));assert.equal(s.document,undefined);assert.equal(s.project.composition,undefined);assert.throws(()=>{s.project.name='Changed';},TypeError);assert.equal((await runtime.dispatchAction({type:'transport.seek',ratio:NaN})).status,'invalid');await runtime.dispatchAction({type:'transport.seek',ratio:.5});assert.equal(calls.at(-1).name,'playback_seek');assert.equal(calls.at(-1).args.frame,'96000');await runtime.dispatchAction({type:'monitor.setVolume',db:-12});assert.equal(calls.at(-1).name,'playback_set_volume');assert.equal(calls.at(-1).args.gain_db,-12);}finally{runtime.dispose();}});
test('skin lifecycle switches consumers without replacing runtime, playback or project and removes stale subscriptions',()=>{const {runtime,calls}=fixture(),events=[];const make=id=>({manifest:{id,contractVersion:1},mount({dispatch,initialSnapshot}){events.push([id,'mount',initialSnapshot.transport.id]);return {update(s){events.push([id,'update',s.sequence]);},dispose(){events.push([id,'dispose']);}};}});const registry=createSkinRegistry([make('deck'),make('transport')]);const host=createSkinHost({root:{replaceChildren(){}},runtime,registry});host.select('deck');host.select('transport');assert.equal(runtime.snapshot().transport.id,'live');assert.equal(runtime.snapshot().project.id,'song');assert.equal(calls.length,0);events.length=0;runtime.patch({position:'222'});assert.deepEqual(events.map(e=>e.slice(0,2)),[['transport','update']]);host.dispose();events.length=0;runtime.patch({position:'333'});assert.equal(events.length,0);runtime.dispose();assert.throws(()=>createSkinRegistry([{manifest:{id:'bad',contractVersion:2},mount(){}}]),/contract/);});
test('combined stop/home key stops at the current position, then rewinds on the next press',async()=>{
 for(const state of ['playing','paused','queued','starting']){
  const calls=[];
  const runtime=createControlRuntime({application:{async invoke(name,args){calls.push({name,args});return {playback_id:'live',project_id:'song',state:'stopped'};}},host:{clearMessage(){}},onError:e=>{throw e;}});
  try{
   runtime.patch({document:doc,projectId:'song',position:'96000',playback:{playback_id:'live',project_id:'song',state}});
   assert.equal(runtime.snapshot().keys[0].label,'停止');
   assert.equal((await runtime.dispatchAction({type:'control.key',index:0})).status,'accepted');
   assert.equal(calls.at(-1).name,'playback_stop');
   assert.equal(runtime.getState().position,'96000');
   assert.equal(runtime.snapshot().keys[0].label,'先頭へ');
   await runtime.dispatchAction({type:'control.key',index:0});
   assert.equal(runtime.getState().position,'0');assert.equal(calls.length,1);
  }finally{runtime.dispose();}
 }
});
