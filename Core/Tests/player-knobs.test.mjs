import { createLocalApplication } from '../Build/JS/Application/local-application.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Service} from '../Build/JS/Application/service.js';
import {call} from '../Build/JS/Application/api.js';

test('real device acknowledges live and paused knob gain/pan without saving a revision',{
 skip:process.env.AIDAW_TEST_PLAYBACK!=='1',timeout:15000
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-live-knobs-')),service=new Service(root);
 t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const api=(name,args={})=>call(createLocalApplication(service),name,args);
 await api('project_create',{project_id:'knobs',name:'Knob device test',length_ticks:3840,duration_frames:'480000',instrument_policy:'allow_basic'});
 await api('project_apply',{project_id:'knobs',base_revision:0,request_id:'seed',operations:[{op:'add_track',track:{id:'tone',name:'Quiet test tone',instrument:{kind:'builtin',sound:'sine'},notes:[{id:'n',tick:0,duration:3840,pitch:69,velocity:1}],gain_db:-96}}]});
 const playback=await api('playback_start',{project_id:'knobs',tail_seconds:0,loop:true,monitor_gain_db:-12});
 let status;
 for(let i=0;i<200;i++){
  status=await api('playback_status',{playback_id:playback.playback_id});
  if(['playing','failed'].includes(status.state))break;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(status.state,'playing',status.error);
 assert.equal(status.monitor_gain_db,-12);
 const volume=await api('playback_set_volume',{gain_db:-24});
 assert.equal(volume.monitor_gain_db,-24);
 assert.ok(volume.applied_control_sequence>0);
 await assert.rejects(api('playback_set_volume',{gain_db:1}));
 const changed=await api('playback_set_mix',{changes:[{track_id:'tone',gain_db:-90,pan:-1}]});
 assert.equal(changed.effective_mix.tracks[0].gain_db,-90);assert.equal(changed.effective_mix.tracks[0].pan,-1);
 await api('playback_pause');
 const pausedVolume=await api('playback_set_volume',{gain_db:-96});
 assert.equal(pausedVolume.state,'paused');assert.equal(pausedVolume.monitor_gain_db,-96);
 assert.ok(pausedVolume.applied_control_sequence>volume.applied_control_sequence);
 const paused=await api('playback_set_mix',{changes:[{track_id:'tone',gain_db:-96,pan:1}]});
 assert.equal(paused.state,'paused');assert.equal(paused.effective_mix.tracks[0].pan,1);
 assert.ok(paused.applied_control_sequence>changed.applied_control_sequence);
 const saved=await service.readDocument('knobs');assert.equal(saved.revision,1);assert.equal(saved.composition.tracks[0].gain_db,-96);assert.equal(saved.composition.tracks[0].pan,0);
 await api('playback_stop');assert.equal(service.processing.status().active,null);
});
