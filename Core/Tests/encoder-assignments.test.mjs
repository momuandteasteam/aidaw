import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEncoders,commandForEncoder,validateEncoderAssignments} from '../Source/ControlSurface/encoders.mjs';
const state=()=>({mode:'listen',page:0,projectId:'p',trackId:'t',position:'48000',monitorGain:-12,playback:{state:'playing',duration_frames:'480000'},document:{kind:'composition',revision:1,composition:{tracks:[{id:'t',name:'Lead',gain_db:-6,pan:0}],buses:[]}}});
test('each encoder can independently assign rotation and press, including press-only and empty slots',()=>{
 const s=state();assert.ok(buildEncoders(s).every(e=>!e.enabled));
 for(let index=0;index<4;index++){
  const assigned={...s,encoderAssignments:{composition:{[index]:{rotate:'volume',press:'stop'}}}};
  assert.equal(buildEncoders(assigned)[index].title,'再生音量');
  assert.deepEqual(commandForEncoder(assigned,index,'rotate',-2),{type:'monitorVolume',delta:-1});
  assert.deepEqual(commandForEncoder(assigned,index,'press'),{type:'stop'});
  assert.equal(commandForEncoder({...assigned,busy:true},index,'rotate',1),null);
  assert.deepEqual(commandForEncoder({...assigned,busy:true},index,'press'),{type:'stop'});
  assigned.encoderAssignments.composition[index]={rotate:'none',press:'play'};
  assert.equal(commandForEncoder(assigned,index,'rotate',1),null);
  assert.deepEqual(commandForEncoder(assigned,index,'press'),{type:'play'});
  assigned.encoderAssignments.composition[index]={rotate:'none',press:'none'};
  assert.equal(buildEncoders(assigned)[index].enabled,false);
 }
});
test('gain and pan use their assigned roles instead of physical knob index',()=>{
 const s={...state(),encoderAssignments:{composition:{0:{rotate:'pan',press:'resetPan'},3:{rotate:'gain',press:'commitParameters'}}}};
 assert.deepEqual(commandForEncoder(s,0,'rotate',2),{type:'adjustParameter',parameter:'pan',delta:.04});
 assert.deepEqual(commandForEncoder(s,3,'rotate',-1),{type:'adjustParameter',parameter:'gain_db',delta:-.5});
 assert.deepEqual(commandForEncoder(s,0,'press'),{type:'resetParameter',parameter:'pan'});
 assert.deepEqual(commandForEncoder(s,3,'press'),{type:'commitParameters'});
 assert.equal(commandForEncoder({...s,trackId:null},0,'rotate',1),null);
});
test('encoder preferences reject arbitrary commands and invalid slots and stay scoped by project kind',()=>{
 for(const value of [[],{composition:{4:{rotate:'volume',press:'play'}}},{composition:{0:{rotate:'unknown',press:'play'}}},{composition:{0:{rotate:'seek',press:{type:'run'}}}},{unknown:{}}])assert.ok(validateEncoderAssignments(value));
 const s={...state(),encoderAssignments:{mastering:{0:{rotate:'volume',press:'stop'}}}};
 assert.ok(buildEncoders(s).every(e=>!e.enabled));
 assert.equal(validateEncoderAssignments({composition:{0:{rotate:'seek',press:'none'}}}),null);
});
