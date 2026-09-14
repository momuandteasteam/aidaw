import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeckState,buildPads} from '../Source/ControlSurface/model.mjs';
import {buildHardwareFrame} from '../Source/ControlSurface/hardware-profile.mjs';
import {renderKeySvg} from '../Source/ControlSurface/key-image.mjs';
import {createControlRuntime} from '../Source/Desktop/runtime/control-runtime.mjs';
const tracks=['vocals','drums','bass','other'].map(id=>({id,name:id,mute:false,solo:false,effects:[]}));
const state=()=>({...createDeckState(),projectId:'stems',trackId:'vocals',document:{kind:'separation',revision:1,composition:{tracks}}});
test('stem controls fit both devices and export opens a dialog command',()=>{
 for(const device of ['stream-deck','stream-deck-plus']){
  const keys=buildHardwareFrame(buildPads(state()),device).keys.filter(k=>k.row<2&&k.column<4);
  assert.deepEqual(keys.map(k=>k.action?.type??null),['home','play','separation','selectRelative','mute','solo','switchSeparation','selectRelative']);
  assert.equal(keys[3].action.delta,-1);assert.equal(keys[7].action.delta,1);
  assert.equal(keys[3].enabled,false);assert.equal(keys[7].enabled,true);
  assert.match(keys[2].svg,/M36 14V29/);
 }
});
test('each selected stem supplies its icon and live mix state to both controls',()=>{
 const symbols=new Set();
 for(const track of tracks){
  const pads=buildPads({...state(),trackId:track.id,playback:{effective_mix:{tracks:[{track_id:track.id,mute:true,solo:true}]}}});
  for(const index of [1,4]){assert.equal(pads[index].icon,`stem:${track.id}`);assert.equal(pads[index].secondary,track.name);assert.equal(pads[index].pressed,index===4);}
  assert.equal(pads[1].label,'ミュート');assert.equal(pads[4].label,'ソロ');
  const svg=renderKeySvg(pads[1]);assert.ok(svg.includes({vocals:'ボーカル',drums:'ドラムス',bass:'ベース',other:'その他'}[track.id]));symbols.add(svg);
 }
 assert.equal(symbols.size,4);
 const last=buildPads({...state(),trackId:'other'});assert.equal(last[3].enabled,true);assert.equal(last[6].enabled,false);
 const empty=buildPads({...state(),trackId:null,document:{kind:'separation',composition:{tracks:[]}}});
 for(const index of [1,2,3,4,6])assert.equal(empty[index].enabled,false);
});
test('track navigation and export preserve listening mode and transport',async()=>{
 let opened=0;const errors=[];
 const runtime=createControlRuntime({application:{async invoke(){return {};}},host:{clearMessage(){},async openSeparation(){opened++;}},onError:e=>errors.push(e)});
 try{
  const playback={playback_id:'live',project_id:'stems',state:'paused',position_frames:'96000'};
  runtime.patch({...state(),playback,position:'96000'});
  await runtime.dispatch({type:'selectRelative',target:'track',delta:1});
  assert.equal(runtime.getState().trackId,'drums');
  await runtime.dispatch(buildPads(runtime.getState())[2].command);
  assert.equal(opened,1);assert.equal(runtime.getState().mode,'listen');assert.equal(runtime.getState().trackId,'drums');
  assert.equal(runtime.getState().position,'96000');assert.deepEqual(runtime.getState().playback,playback);assert.deepEqual(errors,[]);
 }finally{runtime.dispose();}
});

import {resolveSurfaceAction} from '../Source/ControlSurface/surface-contract.mjs';
test('file menu export matches the default deck for every project kind',()=>{
 for(const kind of ['separation','composition','mastering']){
  const s={...state(),document:{...state().document,kind}};
  assert.deepEqual(resolveSurfaceAction(s,{type:'audio.export'}).command,buildPads(s)[2].command);
  assert.equal(buildPads(s)[2].label,'書き出し');
 }
 assert.deepEqual(resolveSurfaceAction(createDeckState(),{type:'audio.export'}),{unavailable:true});
});

import {keyAppearance} from '../Source/ControlSurface/key-image.mjs';
test('stem mute and solo light up only when active',()=>{
 for(const type of ['mute','solo']){const off={command:{type},icon:'stem:vocals',label:type,enabled:true,pressed:false},on={...off,pressed:true};assert.notEqual(keyAppearance(off).background,keyAppearance(on).background);assert.doesNotMatch(renderKeySvg(off),/stemGlow/);assert.match(renderKeySvg(on),/stemGlow/);assert.doesNotMatch(renderKeySvg({...on,enabled:false}),/stemGlow/);}
 const s=state();s.document.separation={source_asset_id:'asset',engine:'demucs'};assert.equal(buildPads(s)[5].label,'分離方式');assert.equal(buildPads(s)[5].secondary,'Demucs');assert.equal(buildPads(s)[5].enabled,true);
});
