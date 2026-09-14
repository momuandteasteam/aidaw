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
test('GUI batches gain changes, restores them on selection, retries failed saves, and excludes monitor volume',async()=>{
 const calls=[],errors=[];let fail=false,mix={revision:4,token:'0',entries:[]};
 const document={...doc,composition:{...doc.composition,tracks:[{id:'keys',name:'Keys',gain_db:-6,pan:0}]}};
 const application={async invoke(name,args){calls.push({name,args});if(name==='project_document')return document;if(name==='working_mix_get')return structuredClone(mix);if(name==='working_mix_set'){if(fail)throw Error('disk unavailable');mix={revision:4,token:String(Number(mix.token)+1),entries:[{key:'song:track:keys',target:{...args.target,key:'song:track:keys',project_id:'song',base_revision:4,name:'Keys',gain_db:-6,pan:0},values:args.values,base_values:{gain_db:-6},status:'pending'}]};return {token:mix.token};}return {};}};
 const runtime=createControlRuntime({application,host:{clearMessage(){}},onError:e=>errors.push(e)});
 try{
 runtime.patch({api:['working_mix_get','working_mix_set'],document,projectId:'song',trackId:'keys'});
 for(let i=0;i<10;i++)await runtime.dispatch({type:'adjustParameter',parameter:'gain_db',delta:-.5});
 await runtime.flushMix();assert.equal(calls.filter(c=>c.name==='working_mix_set').length,1);assert.equal(mix.entries[0].values.gain_db,-11);
 await runtime.chooseProject('song');assert.equal(runtime.getState().dialDrafts['song:track:keys'].values.gain_db,-11);
 await runtime.dispatch({type:'monitorVolume',delta:-3});await runtime.flushMix();assert.equal(calls.filter(c=>c.name==='working_mix_set').length,1);
 fail=true;await runtime.dispatch({type:'adjustParameter',parameter:'gain_db',delta:-.5});await assert.rejects(runtime.flushMix(),/disk unavailable/);assert.equal(runtime.getState().dialDrafts['song:track:keys'].values.gain_db,-11.5);
 fail=false;await runtime.flushMix();assert.equal(mix.entries[0].values.gain_db,-11.5);
 }finally{runtime.dispose();}
});
test('GUI export preflight honors include, keep and discard; restore retains its historical target',async()=>{
 for(const choice of ['include','keep','discard']){
  const calls=[];let revision=4,entries=[{key:'song:track:t',target:{name:'Track'},values:{gain_db:-3},base_values:{gain_db:0},status:'pending'}];
  const application={async invoke(name,args){calls.push({name,args});if(name==='working_mix_get')return {revision,token:'1',entries};if(name==='working_mix_resolve'){entries=[];if(args.action==='include')revision++;return {revision};}if(name==='project_document')return {...doc,revision};if(name==='project_history')return {entries:[]};if(name==='project_save')return {output:'/mock/project.zip'};return {};}};
  const errors=[],runtime=createControlRuntime({application,host:{clearMessage(){},async form(title,fields){assert.equal(fields[0].value,'include');return {action:choice};},async saveOutput(){}},onError:e=>errors.push(e)});
  try{
   runtime.patch({api:['working_mix_get','working_mix_set','working_mix_resolve'],projectId:'song',document:doc});
   await runtime.dispatch({type:'save'});assert.equal(errors.length,0);const save=calls.find(c=>c.name==='project_save');assert.ok(save);
   if(choice==='keep')assert.deepEqual(save.args.working_copy,{action:'keep',token:'1'});else assert.equal(calls.find(c=>c.name==='working_mix_resolve').args.action,choice);
   if(choice==='include'){
    entries=[{target:{name:'Track'},values:{pan:.2},base_values:{pan:0},status:'pending'}];runtime.patch({versionId:'2'});await runtime.dispatch({type:'restore'});
    const restore=calls.find(c=>c.name==='project_restore');assert.equal(restore.args.revision,2);assert.equal(restore.args.base_revision,6);
   }
  }finally{runtime.dispose();}
 }
});
test('rewind rejects an in-flight status and stopped sessions do not overwrite home',async()=>{
 let resolveStatus,requested;const waiting=new Promise(r=>requested=r),calls=[];
 const runtime=createControlRuntime({application:{bootstrap:async()=>({projects:[]}),async invoke(name,args){calls.push({name,args});if(name==='playback_status'){requested();return new Promise(r=>resolveStatus=r);}if(name==='project_document')return doc;if(name==='project_list')return {projects:[]};if(name==='playback_seek')return {playback_id:'live',state:'playing',position_frame:'0'};return {};}},host:{preferences:async()=>({}),configure:async()=>{},clearMessage(){}},onError:e=>{throw e;}});
 try{await runtime.start();runtime.patch({projectId:'song',document:doc,position:'96000',playback:{playback_id:'live',state:'playing',duration_frames:'192000'}});await waiting;
 await runtime.dispatchAction({type:'transport.home'});resolveStatus({playback_id:'live',state:'playing',position_frame:'96000'});await new Promise(r=>setTimeout(r,20));assert.equal(runtime.getState().position,'0');
 runtime.patch({playback:{playback_id:'live',state:'completed',position_frame:'192000'},position:'96000'});await runtime.dispatchAction({type:'transport.home'});const count=calls.filter(c=>c.name==='playback_status').length;await new Promise(r=>setTimeout(r,450));assert.equal(runtime.getState().position,'0');assert.equal(calls.filter(c=>c.name==='playback_status').length,count);
 }finally{runtime.dispose();}
});

test('strip seek rounds fractional positions and clamps the right edge inside audio',async()=>{const {runtime,calls}=fixture();try{for(const [ratio,frame]of [[.123456789,'23704'],[1,'191999']]){runtime.patch({playback:{playback_id:'live',state:'paused',duration_frames:'192000'}});await runtime.dispatchAction({type:'transport.seek',ratio});assert.equal(calls.at(-1).args.frame,frame);assert.equal(runtime.getState().position,frame);}}finally{runtime.dispose();}});
