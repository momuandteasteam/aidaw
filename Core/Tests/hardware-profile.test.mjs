import test from 'node:test';
import assert from 'node:assert/strict';
import {renderKeyFrame} from '../Source/ControlSurface/key-image.mjs';
import {buildPads,createDeckState,modes} from '../Source/ControlSurface/model.mjs';
import {buildHardwareFrame,hardwareKeyAction,buildHardwareSurface,hardwareEncoderAction} from '../Source/ControlSurface/hardware-profile.mjs';

test('both device matrices use the identical core eight actions without hardware-specific banks',()=>{
 for(const mode of modes){
  const pads=buildPads({...createDeckState(),mode});
  const classic=buildHardwareFrame(pads),plus=buildHardwareFrame(pads,'stream-deck-plus');
  assert.deepEqual(renderKeyFrame(pads).map(k=>[k.sourceIndex,k.column,k.row,k.svg]),classic.keys.map(k=>[k.sourceIndex,k.column,k.row,k.svg]));
  assert.equal(classic.keys.length,15);assert.equal(plus.keys.length,8);
  assert.equal(classic.profile.keyPixels,72);assert.equal(plus.profile.keyPixels,120);
  assert.equal(plus.profile.touch.width,800);assert.equal(plus.profile.touch.segmentWidth,200);assert.equal(plus.profile.encoders,4);
  assert.equal(classic.profile.encoders,0);assert.equal(classic.profile.touch,null);
  for(let index=0;index<8;index++){
   const desktopKey=classic.keys[Math.floor(index/4)*5+index%4];
   assert.deepEqual(desktopKey.action,plus.keys[index].action);
   assert.equal(desktopKey.sourceIndex,plus.keys[index].sourceIndex);
   assert.equal(desktopKey.svg,plus.keys[index].svg);
   assert.equal(plus.keys[index].column,index%4);assert.equal(plus.keys[index].row,Math.floor(index/4));
   assert.equal(plus.keys[index].essential,true);
   assert.deepEqual(plus.keys[index].action,pads[(mode==='listen'?[0,7,2,3,1,4,5,6]:[0,1,2,6,3,4,5,7])[index]].command);
  }
  assert.ok(classic.keys.every(key=>key.essential===(key.column<4&&key.row<2)));
  assert.deepEqual(classic.keys.filter(key=>key.column===4).map(key=>key.sourceIndex),[8,9,10]);
  assert.deepEqual(classic.keys.filter(key=>key.row===2&&key.column<4).map(key=>key.sourceIndex),[11,12,13,14]);
 }
});

test('disabled and invalid physical keys emit no command',()=>{
 const pads=buildPads(createDeckState()),frame=buildHardwareFrame(pads,'stream-deck-plus');
 const disabled=frame.keys.find(key=>!key.enabled);
 if(disabled)assert.equal(hardwareKeyAction(frame,disabled.column,disabled.row),null);
 assert.equal(hardwareKeyAction(frame,-1,0),null);assert.equal(hardwareKeyAction(frame,4,0),null);assert.equal(hardwareKeyAction(frame,0,2),null);
 for(const key of frame.keys)if(key.enabled)assert.deepEqual(hardwareKeyAction(frame,key.column,key.row),key.action);
 assert.throws(()=>buildHardwareFrame(pads,'unknown'),/Unknown/);
 assert.throws(()=>buildHardwareFrame([], 'stream-deck'),/15/);
});

test('Plus encoder and touch feedback share the desktop semantic controls, without requiring them on Classic',()=>{
 const state={...createDeckState(),mode:'tracks',encoderAssignments:{composition:{2:{rotate:'gain',press:'commitParameters'},3:{rotate:'pan',press:'commitParameters'}}},projectId:'song',trackId:'piano',document:{kind:'composition',revision:1,composition:{duration_frames:'48000',tracks:[{id:'piano',name:'Piano',gain_db:-12,pan:0}],buses:[]}}};
 const classic=buildHardwareSurface(state),plus=buildHardwareSurface(state,'stream-deck-plus');
 assert.equal(classic.encoders.length,0);assert.equal(plus.encoders.length,4);
 assert.equal(plus.touch.width,800);assert.equal(plus.touch.height,100);
 assert.deepEqual(plus.encoders.map(item=>item.index),[0,1,2,3]);
 assert.deepEqual(hardwareEncoderAction(state,'stream-deck-plus',2,'rotate',2),{type:'adjustParameter',parameter:'gain_db',delta:1});
 assert.deepEqual(hardwareEncoderAction(state,'stream-deck-plus',3,'press'),{type:'commitParameters'});
 assert.equal(hardwareEncoderAction(state,'stream-deck',2,'rotate',2),null);
 assert.equal(hardwareEncoderAction(state,'stream-deck-plus',4,'rotate',2),null);
});
