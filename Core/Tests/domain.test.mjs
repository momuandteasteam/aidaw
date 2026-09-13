import test from 'node:test';
import assert from 'node:assert/strict';
import {project} from '../Build/JS/Domain/schema.js';
import {parseDocument,compositionFromGraph,compileDocument,applyDocumentOperations} from '../Build/JS/Domain/domain.js';
import {compileComposition,compileMastering} from '../Build/JS/Domain/mode-compilers.js';
import {JuceFileWorker as Engine} from '../Build/JS/Adapters/node/engine/juce-file-driver.js';

const graph=(tracks=[],buses=[])=>project.parse({schema_version:2,id:'album',name:'作品',revision:0,instrument_policy:'allow_basic',sample_rate:48000,ppq:960,bpm:120,meter:[4,4],length_ticks:3840,tracks,sections:[],harmony:[],buses,master_effects:[]});
const tone=(id,extra={})=>({id,name:id,instrument:{kind:'builtin',sound:'sine'},gain_db:-24,notes:[{id:'note',tick:0,duration:3840,pitch:69,velocity:80}],...extra});
const version=(id,extra={})=>({id,label:id,created_at:'2026-09-14T00:00:00.000Z',created_revision:1,source_asset_id:'source',source_sha256:'a'.repeat(64),clip:{kind:'audio',asset_id:'source',end_frame:'48000'},duration_frames:'48000',tail_seconds:0,input_gain_db:0,effects:[],...extra});
const song=(id)=>({id,name:id,versions:[version('v1')],current_version_id:'v1',comparison:{a:{kind:'version',version_id:'v1'},b:{kind:'version',version_id:'v1'}}});
const album=()=>parseDocument({schema_version:3,kind:'mastering',id:'album',name:'アルバム',revision:1,mastering:{song_order:['song1','song2'],songs:[song('song1'),song('song2')]}});

test('composition has no arbitrary track count and compiles without altering routing',()=>{
 const p=graph(Array.from({length:257},(_,i)=>tone(`part${i}`)));
 const d=compositionFromGraph(p);assert.deepEqual(compileComposition(d),p);assert.equal(d.kind,'composition');assert.deepEqual(compileDocument(d),p);
 const after=applyDocumentOperations(d,[{op:'set_track',track_id:'part256',changes:{mute:true}}]);
 assert.equal(after.composition.tracks.length,257);assert.equal(after.composition.tracks[256].mute,true);assert.equal(d.composition.tracks[256].mute,false);
});
test('album versions, current, accepted and A/B are independent per song',()=>{
 const original=album();const updated=applyDocumentOperations(original,[{op:'add_version',song_id:'song1',version:version('v2',{parent_version_id:'v1',input_gain_db:-6})},{op:'set_accepted_version',song_id:'song1',version_id:'v1'},{op:'set_comparison',song_id:'song1',slot:'b',selection:{kind:'version',version_id:'v2'}}]);
 const one=updated.mastering.songs[0];assert.equal(one.current_version_id,'v2');assert.equal(one.accepted_version_id,'v1');assert.equal(one.comparison.a.version_id,'v1');assert.equal(one.comparison.b.version_id,'v2');assert.deepEqual(updated.mastering.songs[1],original.mastering.songs[1]);assert.equal(original.mastering.songs[0].versions.length,1);
 const a=compileDocument(updated,{song_id:'song1',comparison:'a'}),b=compileDocument(updated,{song_id:'song1',comparison:'b'});
 assert.deepEqual(compileMastering(updated,{song_id:'song1',comparison:'b'}),b);assert.equal(a.tracks[0].gain_db,0);assert.equal(b.tracks[0].gain_db,-6);assert.equal(b.tracks.length,1);assert.equal(b.buses.length,0);assert.equal(b.id,'album');
 assert.throws(()=>applyDocumentOperations(updated,[{op:'add_version',song_id:'song1',version:version('v2')}]),/immutable/);
 assert.throws(()=>applyDocumentOperations(updated,[{op:'set_comparison',song_id:'song2',slot:'a',selection:{kind:'version',version_id:'v2'}}]),/another song|unknown/);
});
test('mode and reference validation reject ambiguous or broken graphs',()=>{
 assert.throws(()=>compileDocument(album()),/song_id/);
 assert.throws(()=>applyDocumentOperations(album(),[{op:'add_track',track:tone('wrong') }]),/Composition operation/);
 assert.throws(()=>applyDocumentOperations(compositionFromGraph(graph()),[{op:'add_song',song:song('wrong')}]),/Mastering operation/);
 assert.throws(()=>applyDocumentOperations(album(),[{op:'set_song_order',song_ids:['song1','song1']}]),/exactly once/);
 assert.throws(()=>parseDocument({...album(),mastering:{song_order:['song1'],songs:[{...song('song1'),versions:[version('v1',{source_asset_id:'other'})]}]}}),/must match/);
 assert.throws(()=>compileDocument(album(),{song_id:'song1',version_id:'v1',comparison:'a'}),/not both/);
});
test('source A/B has an explicit stable clip anchor and bypasses gain, fades and effects',()=>{
 const doc=applyDocumentOperations(album(),[
  {op:'add_version',song_id:'song1',version:version('v2',{parent_version_id:'v1',input_gain_db:-9,clip:{kind:'audio',asset_id:'source',start_frame:'12000',end_frame:'36000',timeline_frame:'0',fade_in_frames:'1000',fade_out_frames:'1000'},duration_frames:'24000'})},
  {op:'set_comparison',song_id:'song1',slot:'a',selection:{kind:'source',source_asset_id:'source',version_id:'v2'}},
  {op:'set_comparison',song_id:'song1',slot:'b',selection:{kind:'source',source_asset_id:'source'}},
 ]);
 const a=compileDocument(doc,{song_id:'song1',comparison:'a'}),b=compileDocument(doc,{song_id:'song1',comparison:'b'});
 assert.equal(a.duration_frames,'24000');assert.equal(a.tracks[0].instrument.start_frame,'12000');assert.equal(a.tracks[0].instrument.fade_in_frames,'0');assert.equal(a.tracks[0].instrument.fade_out_frames,'0');assert.equal(a.tracks[0].gain_db,0);assert.deepEqual(a.master_effects,[]);
 assert.equal(b.duration_frames,'48000'); // Unanchored legacy source comparisons stay on the earliest source version.
 assert.throws(()=>applyDocumentOperations(doc,[{op:'set_comparison',song_id:'song1',slot:'a',selection:{kind:'source',source_asset_id:'source',version_id:'missing'}}]),/anchor/);
});
test('native live graph applies hot mute and solo to main and return routing above 64 tracks',async()=>{
 const p=graph([tone('left',{pan:-1,sends:[{bus_id:'room',gain_db:0}]}),tone('right',{pan:1}),...Array.from({length:63},(_,i)=>tone(`silent${i}`,{mute:true}))],[{id:'room',name:'Room',effects:[],gain_db:0,pan:0,mute:false,solo:false}]);
 const result=await new Engine().call({command:'playback_graph_probe',project:p,segments:[
  {blocks:8},
  {blocks:8,changes:[{track_id:'left',mute:true}]},
  {blocks:8,changes:[{track_id:'left',mute:false},{bus_id:'room',solo:true}]},
  {blocks:8,changes:[{track_id:'right',solo:true}]},
  {blocks:8,changes:[{bus_id:'room',solo:false},{track_id:'right',mute:true}]},
  {blocks:8,changes:[{track_id:'right',mute:false}]},
 ]});
 const [both,right,send,none,muted,restored]=result.segments;
 assert.ok(both.left_peak>0&&both.right_peak>0);assert.ok(right.left_peak<1e-8);assert.ok(right.right_peak>0);
 assert.ok(send.left_peak>0);assert.ok(send.right_peak<1e-8);assert.equal(none.left_peak,0);assert.equal(none.right_peak,0);
 assert.equal(muted.left_peak,0);assert.equal(muted.right_peak,0);assert.ok(restored.left_peak<1e-8);assert.ok(restored.right_peak>0);
 assert.equal(restored.applied_control_sequence,5);assert.equal(restored.effective_mix.tracks.length,65);
 await assert.rejects(new Engine().call({command:'playback_graph_probe',project:p,segments:[{blocks:1,changes:[{track_id:'missing',mute:true}]}]}),/Unknown playback track/);
});
test('native live gain and pan affect track and return audio while pre-fader sends retain their level',async()=>{
 const p=graph([tone('track',{pan:-1,sends:[{bus_id:'room',gain_db:0,position:'pre_fader'}]})],[{id:'room',name:'Room',effects:[],gain_db:0,pan:0,mute:true,solo:false}]);
 const {segments}=await new Engine().call({command:'playback_graph_probe',project:p,segments:[
  {blocks:8},
  {blocks:8,changes:[{track_id:'track',gain_db:-30}]},
  {blocks:8,changes:[{track_id:'track',pan:1}]},
  {blocks:8,changes:[{bus_id:'room',mute:false,solo:true,pan:-1}]},
  {blocks:8,changes:[{track_id:'track',gain_db:-50}]},
  {blocks:8,changes:[{bus_id:'room',gain_db:-6}]},
  {blocks:8,changes:[{bus_id:'room',pan:1}]},
 ]});
 const [base,quiet,right,preSend,preSendUnchanged,quietReturn,rightReturn]=segments;
 const close=(a,b,epsilon=0.005)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
 close(quiet.left_peak/base.left_peak,10**(-6/20));assert.ok(right.left_peak<1e-8);assert.ok(right.right_peak>0);
 close(preSendUnchanged.left_peak/preSend.left_peak,1);close(quietReturn.left_peak/preSendUnchanged.left_peak,10**(-6/20));assert.ok(rightReturn.left_peak<1e-8);assert.ok(rightReturn.right_peak>0);
 close(quiet.effective_mix.tracks[0].gain_db,-30,0.0001);assert.equal(right.effective_mix.tracks[0].pan,1);close(quietReturn.effective_mix.returns[0].gain_db,-6,0.0001);assert.equal(rightReturn.effective_mix.returns[0].pan,1);
 assert.equal(rightReturn.applied_control_sequence,6);
 for(const changes of [[{track_id:'track',gain_db:13}],[{bus_id:'room',pan:-2}]])await assert.rejects(new Engine().call({command:'playback_graph_probe',project:p,segments:[{blocks:1,changes}]}),/Number out of range/);
});

test('monitor volume attenuates final playback output without changing the graph mix',async()=>{
 const p=graph([tone('monitor')],[]);
 const {segments:[full,quiet,silent,restored]}=await new Engine().call({command:'playback_graph_probe',project:p,segments:[
  {blocks:32},{blocks:32,monitor_gain_db:-12},{blocks:32,monitor_gain_db:-96},{blocks:32,monitor_gain_db:0}
 ]});
 assert.ok(full.left_peak>0);assert.ok(Math.abs(quiet.left_peak/full.left_peak-Math.pow(10,-12/20))<0.002);
 assert.equal(silent.left_peak,0);assert.equal(silent.right_peak,0);
 assert.ok(Math.abs(restored.left_peak/full.left_peak-1)<0.002);
 assert.deepEqual(quiet.effective_mix,full.effective_mix);assert.deepEqual(restored.effective_mix,full.effective_mix);
 await assert.rejects(new Engine().call({command:'playback_graph_probe',project:p,segments:[{blocks:1,monitor_gain_db:1}]}),/Number out of range/);
});
