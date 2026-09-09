import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {fixture,seed,track} from './helpers.mjs';
test('part edits only invalidate downstream mixer nodes; pre/post sends and return fader remain independent',async t=>{
 const {api,service}=await fixture(t);await seed(api,{...track,gain_db:-18});
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'mixer',operations:[{op:'add_track',track:{...track,id:'bass',notes:[{id:'b',tick:0,duration:960,pitch:40,velocity:100}],gain_db:-18}},{op:'set_buses',buses:[{id:'space',name:'Reverb return',effects:[],pan:.3}]},{op:'set_track',track_id:'keys',changes:{sends:[{bus_id:'space',gain_db:-12,position:'pre_fader'}]}}]});
 const render=async()=>service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);
 const first=await render();assert.equal(first.state,'succeeded',first.error);
 await api('project_apply',{project_id:'song',base_revision:2,request_id:'fader',operations:[{op:'set_track',track_id:'keys',changes:{gain_db:-24}}]});const second=await render();assert.equal(second.state,'succeeded',second.error);
 assert.equal(second.render_graph.find(n=>n.node==='instrument-keys').reused,true);assert.equal(second.render_graph.find(n=>n.node==='insert-keys').reused,true);assert.equal(second.render_graph.find(n=>n.node==='fader-keys').reused,false);assert.equal(second.render_graph.find(n=>n.node==='send-space').reused,true);assert.equal(second.render_graph.find(n=>n.node==='instrument-bass').reused,true);
 assert.equal(second.stems.space.sha256,first.stems.space.sha256);
 await api('project_apply',{project_id:'song',base_revision:3,request_id:'part',operations:[{op:'replace_notes',track_id:'bass',notes:[{id:'b',tick:0,duration:960,pitch:43,velocity:100}]}]});const third=await render();assert.equal(third.render_graph.find(n=>n.node==='instrument-bass').reused,false);assert.equal(third.render_graph.find(n=>n.node==='instrument-keys').reused,true);assert.equal(third.render_graph.find(n=>n.node==='send-space').reused,true);
 await api('project_apply',{project_id:'song',base_revision:4,request_id:'return',operations:[{op:'set_bus',bus_id:'space',changes:{gain_db:-6}}]});const fourth=await render();assert.equal(fourth.render_graph.find(n=>n.node==='return-insert-space').reused,true);assert.equal(fourth.render_graph.find(n=>n.node==='stem-space').reused,false);assert.equal((await api('mixer_inspect',{project_id:'song'})).returns[0].pan,.3);
 const fresh=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0,rerender_tracks:['keys']})).job_id);assert.equal(fresh.render_graph.find(n=>n.node==='instrument-keys').reused,false);assert.equal(fresh.render_graph.find(n=>n.node==='instrument-bass').reused,true);
 const delivered=await api('delivery_publish',{project_id:'song',job_id:fresh.id,tags:{title:'Mix'},mp3:false});const report=JSON.parse(await readFile(join(delivered.output_directory,'reports','delivery.json')));assert.equal(report.stem_roles.space,'fx_return');
});
test('MIDI import assigns instruments and preserves performance note timing',async t=>{
 const {api,service}=await fixture(t);await seed(api);const exported=await api('export_midi',{project_id:'song'});const midi=await api('midi_inspect',{path:exported.output});assert.equal(midi.tracks[1].notes[0].pitch,69);
 await api('project_create',{instrument_policy:'allow_basic',project_id:'imported',name:'MIDI import',length_ticks:1});await api('midi_import',{project_id:'imported',base_revision:0,request_id:'import',path:exported.output,adopt_tempo:true,tracks:[{track_index:1,track_id:'piano',instrument:{kind:'builtin',sound:'keys'}}]});const p=await service.read('imported');assert.equal(p.tracks[0].notes[0].tick,960);assert.equal(p.tracks[0].notes[0].duration,960);assert.equal(p.length_ticks,3840);
 const job=await service.wait((await api('render_start',{project_id:'imported'})).job_id);assert.equal(job.state,'succeeded',job.error);assert.ok(job.analysis.sample_peak>0);
});
test('post-fader sends follow track volume; return solo keeps send inputs and mute silences a return',async t=>{
 const {api,service}=await fixture(t);await seed(api,{...track,gain_db:-18});await api('project_apply',{project_id:'song',base_revision:1,request_id:'send',operations:[{op:'set_buses',buses:[{id:'delay',name:'Delay',effects:[]}]},{op:'set_track',track_id:'keys',changes:{sends:[{bus_id:'delay',gain_db:-6}]}}]});
 const render=async()=>service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);const a=await render();
 await api('project_apply',{project_id:'song',base_revision:2,request_id:'down',operations:[{op:'set_track',track_id:'keys',changes:{gain_db:-24}}]});const b=await render();assert.ok(Math.abs(b.stems.delay.analysis.sample_peak/a.stems.delay.analysis.sample_peak-Math.pow(10,-6/20))<.0001);
 await api('project_apply',{project_id:'song',base_revision:3,request_id:'solo-return',operations:[{op:'set_bus',bus_id:'delay',changes:{solo:true}}]});const c=await render();assert.equal(c.stems.keys.analysis.sample_peak,0);assert.ok(c.stems.delay.analysis.sample_peak>0);
 await api('project_apply',{project_id:'song',base_revision:4,request_id:'mute-return',operations:[{op:'set_bus',bus_id:'delay',changes:{mute:true}}]});const d=await render();assert.equal(d.analysis.sample_peak,0);
});
