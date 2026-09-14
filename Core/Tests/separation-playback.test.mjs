import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {prepareStemPlayback,stemMixChanges} from '../Build/JS/Application/separation-playback.js';
const tracks=['vocals','drums','bass','other'].map(id=>({id,name:id,instrument:{kind:'audio',asset_id:id+'-asset',start_frame:'0',end_frame:'48000',timeline_frame:'0'},notes:[],effects:[],sends:[],gain_db:0,pan:0,mute:false,solo:false,to_master:true}));
test('stem sets share solo/mute and switch on the same worker and frame',async t=>{
 const {service,api}=await fixture(t);await api('project_create',{project_id:'stems',kind:'separation',name:'Stems',bpm:120,length_ticks:1920});
 await service.workspace.change({projectId:'stems',baseRevision:0,requestId:'seed',fingerprint:'seed'},async d=>{
 const graph={...d.composition,duration_frames:'48000',tracks};return {...d,revision:1,composition:graph,separation:{source_asset_id:'source',engine:'spleeter',model:'4stems-16kHz',job_id:'initial',variants:{demucs:{source_asset_id:'source',engine:'demucs',model:'htdemucs',job_id:'other',graph}}}};
 });
 const doc=await service.readDocument('stems'),graph=structuredClone(doc.composition);
 const stems=prepareStemPlayback(doc,graph,[{track_id:'vocals',solo:true,mute:false}]);assert.equal(graph.tracks.length,8);
 const controls=[];const worker={status:async()=>({state:'playing',position_frame:'24000',monitor_gain_db:-6}),control:async c=>controls.push(c),close:async()=>{}};
 service.playback={id:'live',project_id:'stems',revision:1,kind:'separation',state:'playing',stems,worker,track_ids:new Set(tracks.map(t=>t.id)),created_at:'now',done:Promise.resolve()};
 t.after(()=>{service.playback=undefined;});
 let result=await api('playback_switch_separation',{project_id:'stems',playback_id:'live',engine:'demucs',base_revision:1,request_id:'demucs'});
 assert.equal(result.position_frame,'24000');assert.equal(result.playback_id,'live');assert.equal(result.separation_engine,'demucs');assert.equal(result.effective_mix.tracks[0].solo,true);
 assert.ok(controls.every(c=>c.action==='set_mix'));assert.equal(controls[0].changes.find(c=>c.track_id==='vocals').solo,false);assert.equal(controls[0].changes.find(c=>c.track_id==='variant-demucs-vocals').solo,true);
 await service.setPlaybackMix([{track_id:'vocals',solo:false,mute:true}],'live');
 result=await api('playback_switch_separation',{project_id:'stems',playback_id:'live',engine:'spleeter',base_revision:2,request_id:'spleeter'});
 assert.equal(result.effective_mix.tracks[0].mute,true);assert.equal(result.effective_mix.tracks[0].solo,false);assert.equal(service.playback.worker,worker);
 await service.setPlaybackMix([{track_id:'vocals',solo:true}],'live');
 assert.equal(controls.at(-1).changes.find(c=>c.track_id==='vocals').mute,false);
 assert.equal((await service.playbackStatus('live')).effective_mix.tracks[0].mute,true);
 await service.setPlaybackMix([{track_id:'drums',solo:true}],'live');
 let mix=(await service.playbackStatus('live')).effective_mix.tracks;assert.equal(mix.filter(t=>t.solo).length,1);assert.equal(mix.find(t=>t.solo).track_id,'drums');
 await service.setPlaybackMix([{track_id:'drums',solo:false}],'live');assert.equal(controls.at(-1).changes.find(c=>c.track_id==='vocals').mute,true);
 const count=controls.length;await assert.rejects(api('playback_switch_separation',{project_id:'stems',playback_id:'live',engine:'demucs',base_revision:1,request_id:'conflict'}),/Revision conflict/);assert.equal(controls.length,count);
 assert.equal((await service.readDocument('stems')).composition.tracks[0].mute,false);
});
