import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../Build/JS/Adapters/node/engine/engine.js';
import {audioPlan} from '../Build/JS/Contracts/engine-contracts.js';
import {Service} from '../Build/JS/Application/service.js';
import {createLocalApplication} from '../Build/JS/Application/local-application.js';
import {call} from '../Build/JS/Application/api.js';
import {create,track} from './helpers.mjs';

class FakeDriver {
 major=1;features=['render.v1','playback.v1','compareAudio.v1','listAudioOutputs.v1'];calls=[];
 async describe(){return {id:'test.silent',version:'1',adapter_id:'test',adapter_version:'1',contract:{major:this.major,minor:0},content_fingerprint:'fake-v1',features:this.features,sample_rates:[48000],plugin_formats:[]};}
 async invoke(operation,request){
  this.calls.push(operation);assert.equal(request.command,undefined);
  if(operation==='listAudioOutputs')return {device_types:[],default_output:'test',required_sample_rate:48000};
  if(operation==='compareAudio')return {max_absolute_difference:0,rms_difference:0,frames:96000,exact_samples:true};
  assert.equal(operation,'render');assert.equal(request.plan.contract,'aidaw.audio-plan');assert.equal(request.plan.version,1);assert.equal(request.plan.graph,undefined);assert.ok(Array.isArray(request.plan.channels));
  for(const name of ['description_xml','audio_source_path','rendered_audio_path','cached_gain_db','unity_gain','audio_clip'])assert.ok(!JSON.stringify(request.plan).includes('\"'+name+'\"'));
  const frames=96000,bytes=Buffer.alloc(44+frames*6);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(48000*6,28);bytes.writeUInt16LE(6,32);bytes.writeUInt16LE(24,34);bytes.write('data',36);bytes.writeUInt32LE(frames*6,40);await writeFile(request.output,bytes);
  return {output:request.output,revision:request.plan.provenance.revision,analysis:{frames,sample_rate:48000,channels:2,duration_seconds:2,sample_peak:0,rms:0,clipped_samples:0,silent:true,measurement:'fake test silence'},automation:[],latency_compensation:{tracks:[],master_samples:0,trimmed_samples:0}};
 }
 async startPlayback(request){
  assert.equal(request.command,undefined);assert.equal(request.status_path,undefined);assert.equal(request.plan.version,1);
  let state={state:'playing',position_frame:request.start_frame,control_sequence:0},finish;
  const done=new Promise(resolve=>finish=resolve);
  return {ready:Promise.resolve(state),done,status:async()=>state,control:async c=>{state={...state,control_sequence:state.control_sequence+1,...(c.action==='seek'?{position_frame:c.frame}:{}),...(c.action==='pause'?{state:'paused'}:{}),...(c.action==='resume'?{state:'playing'}:{})};if(c.action==='stop'){state={...state,state:'stopped'};finish(state);}},close:async()=>finish({state:'stopped'})};
 }
 async close(){}
}
test('same application workflows run with a replacement engine having no native worker protocol',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-port-')),driver=new FakeDriver(),engine=new Engine(undefined,{driver}),service=new Service(root,engine),application=createLocalApplication(service);
 t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const api=(name,args={})=>call(application,name,args);
 await api('project_create',create);await api('project_apply',{project_id:'song',base_revision:0,request_id:'edit',operations:[{op:'add_track',track}]});
 const rendered=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);assert.equal(rendered.state,'succeeded',rendered.error);assert.ok(driver.calls.includes('render'));
 const playback=await api('playback_start',{project_id:'song'});
 for(let i=0;i<50;i++){if((await api('playback_status',{playback_id:playback.playback_id})).state==='playing')break;await new Promise(r=>setTimeout(r,5));}
 await api('playback_seek',{playback_id:playback.playback_id,frame:'24000'});assert.equal((await api('playback_status',{playback_id:playback.playback_id})).position_frame,'24000');
 await api('playback_stop',{playback_id:playback.playback_id});assert.equal((await api('playback_status',{playback_id:playback.playback_id})).state,'stopped');
 assert.equal((await engine.describe()).content_fingerprint,'fake-v1');assert.equal(engine.call,undefined);assert.equal(engine.executable,undefined);
});
test('negotiation rejects incompatible drivers and missing features before invoking them',async()=>{
 const driver=new FakeDriver(),engine=new Engine(undefined,{driver});driver.major=2;
 await assert.rejects(engine.listAudioOutputs(),e=>e.code==='CONTRACT_INCOMPATIBLE');driver.major=1;driver.features=[];
 await assert.rejects(engine.render({plan:audioPlan({}),output:'unused',tail_seconds:0}),e=>e.code==='FEATURE_UNAVAILABLE');assert.deepEqual(driver.calls,[]);
});

test('portable plan has explicit processor and channel DTOs and excludes native bindings',()=>{
 const plan=audioPlan({id:'p',tracks:[{id:'track',instrument:{kind:'plugin',plugin_id:'vst3:test',description_xml:'<native />',parameters:[{id:'level',value:0.5}]},notes:[],gain_db:-6}],master_effects:[]});
 assert.equal(plan.channels[0].source.type,'processor');assert.equal(plan.channels[0].source.processor.plugin_id,'vst3:test');assert.equal(plan.channels[0].level.gain_db,-6);assert.equal(plan.graph,undefined);assert.ok(!JSON.stringify(plan).includes('description_xml'));assert.ok(!JSON.stringify(plan).includes('<native'));
 assert.throws(()=>audioPlan({tracks:[{id:'t',instrument:{kind:'plugin',plugin_id:'x',parameters:[{id:'x',value:2}]}}]}),/out of range/);
});
