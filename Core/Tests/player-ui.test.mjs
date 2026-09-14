import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIsPlayable, startFrame, statusBelongsToProject } from '../Source/ControlSurface/model.mjs';
import { createDeckState, buildPads, commandForPad, reduceDeckState, pageCount, pageItems, songsOf, acceptsStatus, modes, auditionChanges } from '../Source/ControlSurface/model.mjs';
import { KEY_LOGICAL_SIZE, KEY_IMAGE_SIZE, renderKeySvg, renderKeyFrame, compactKeyText } from '../Source/ControlSurface/key-image.mjs';

test('player does not carry a completed position or stale status into another project', () => {
  assert.equal(startFrame('96000', '96000'), '0');
  assert.equal(startFrame('12000', '96000'), '12000');
  assert.equal(statusBelongsToProject({ project_id: 'old', state: 'failed', position_frame: '96000' }, 'new'), false);
  assert.equal(statusBelongsToProject({ project_id: 'new', state: 'playing' }, 'new'), true);
});

test('batch containers without tracks are not playable', () => {
  assert.equal(projectIsPlayable({ playable: false, track_count: 0 }), false);
  assert.equal(projectIsPlayable({ playable: true, track_count: 1 }), true);
});

test('every mode always exposes exactly 15 pads and reachable navigation while busy', () => {
  for (const mode of modes) {
    const state={...createDeckState(),mode,busy:true,playback:{state:'starting'}};
    const pads=buildPads(state);
    assert.equal(pads.length,15,mode);
    if(mode==='listen'){assert.equal(pads[0].enabled,true);assert.equal(pads[0].command.type,'stop');assert.equal(pads[6].enabled,false);assert.equal(pads[7].enabled,false);continue;}
    assert.deepEqual(pads.slice(3,8).map(p=>p.command.type),['page','page','back','navigate','stop']);
    assert.equal(pads[5].enabled,true);assert.equal(pads[6].enabled,true);assert.equal(pads[7].enabled,true);
    for(let i=0;i<3;i++)if(!['navigate','page','back','select'].includes(pads[i].command?.type))assert.equal(commandForPad(state,i),null);
  }
});

test('tracks paginate beyond 64 and preserve ID selection across pages and deletion', () => {
  const tracks=Array.from({length:123},(_,i)=>({id:`t${i}`,name:`Track ${i}`,instrument:{kind:'audio'}}));
  let state={...createDeckState(),mode:'tracklist',document:{composition:{tracks}},trackId:'t7'};
  assert.equal(pageCount(state),41);
  for(let i=0;i<50;i++)state=reduceDeckState(state,{type:'page',delta:1});
  assert.equal(state.page,40);assert.equal(state.trackId,'t7');
  assert.equal(buildPads(state)[2].command.itemId,'t122');
  assert.equal(commandForPad(state,4),null);assert.equal(commandForPad(state,15),null);
  state=reduceDeckState(state,{type:'patch',patch:{document:{composition:{tracks:tracks.slice(0,7)}}}});
  assert.equal(state.page,2);
});

test('all historical versions can be selected and assigned without navigating restoration', () => {
  const versions=Array.from({length:101},(_,i)=>({id:`v${i}`,label:`Version ${i}`}));
  const state={...createDeckState(),mode:'versionlist',page:33,document:{kind:'mastering',mastering:{songs:[{id:'s',versions,current_version_id:'v100',comparison:{a:{kind:'version',version_id:'v55'},b:{kind:'version',version_id:'v0'}}}],song_order:['s']}},songId:'s',versionId:'v0'};
  assert.equal(pageCount(state),34);assert.equal(buildPads(state)[1].command.itemId,'v0');
  const actions=buildPads({...state,mode:'history',page:0});assert.equal(actions[1].command.type,'assignA');assert.equal(actions[2].command.type,'assignB');
  assert.equal(reduceDeckState(state,{type:'back'}).versionId,'v0');
});

test('album ordering uses song IDs and add stays on its short action menu', () => {
 const songs=Array.from({length:5},(_,i)=>({id:`s${i}`}));
 const state={...createDeckState(),mode:'songs',document:{kind:'mastering',mastering:{songs,song_order:['s4','s3','s2','s1','s0']}}};
 assert.equal(songsOf(state)[0].id,'s4');assert.equal(pageCount({...state,mode:'songlist'}),2);
 assert.equal(buildPads(state)[1].command.type,'addSong');
});

test('playback state ignores older sessions and other songs', () => {
 const state={...createDeckState(),projectId:'p',songId:'s',playback:{playback_id:'new'}};
 assert.equal(acceptsStatus(state,{playback_id:'old',project_id:'p',song_id:'s'}),false);
 assert.equal(acceptsStatus(state,{playback_id:'new',project_id:'p',song_id:'other'}),false);
 assert.equal(acceptsStatus(state,{playback_id:'new',project_id:'p',song_id:'s'}),true);
});

test('audition clears return solo and restores the runtime baseline', () => {
 const baseline={tracks:[{id:'a',mute:true,solo:false},{id:'b',mute:false,solo:true}],returns:[{id:'fx',mute:false,solo:true}]};
 assert.deepEqual(auditionChanges(baseline,'a'),[{track_id:'a',mute:false,solo:true},{track_id:'b',mute:true,solo:false},{bus_id:'fx',mute:false,solo:false}]);
 assert.equal(auditionChanges(baseline,'b')[2].solo,false);
 assert.deepEqual(auditionChanges(baseline),[{track_id:'a',mute:true,solo:false},{track_id:'b',mute:false,solo:true},{bus_id:'fx',mute:false,solo:true}]);
 assert.equal(baseline.returns[0].solo,true);
});

test('queued and completed jobs keep selectable stable IDs', () => {
 const state={...createDeckState(),mode:'jobs',page:1,jobs:[{job_id:'queued-job',state:'queued'},{id:'complete-job',state:'succeeded'}]};
 assert.equal(buildPads(state)[0].command.itemId,'queued-job');assert.equal(buildPads(state)[1].command.itemId,'complete-job');
 assert.equal(buildPads(state)[0].secondary,'queued');
});

test('key artwork uses the same 72 logical and 144 pixel frame for desktop and hardware', () => {
 assert.equal(KEY_LOGICAL_SIZE,72);assert.equal(KEY_IMAGE_SIZE,144);
 for(const mode of modes){
  const pads=buildPads({...createDeckState(),mode}),keys=renderKeyFrame(pads);
  assert.equal(keys.length,15);
  for(const [i,key]of keys.entries()){
   assert.equal(key.column,i%5);assert.equal(key.row,Math.floor(i/5));assert.deepEqual(key.action,pads[key.sourceIndex].command);
   assert.equal(key.enabled,pads[key.sourceIndex].enabled);assert.match(key.svg,/width="144" height="144" viewBox="0 0 72 72"/);
  }
 }
 assert.throws(()=>renderKeyFrame([]),/15/);
});

test('long key labels are bounded and source text cannot inject SVG content', () => {
 const longLabel=compactKeyText('選択した過去のマスタリングバージョンを比較する');assert.equal(longLabel.length,2);assert.ok(longLabel.every(line=>line.length<=8));assert.ok(longLabel[1].endsWith('…'));
 const svg=renderKeySvg({label:'<script>alert("x")</script>',secondary:'日本語の非常に長いトラック名と履歴バージョン名',enabled:true,command:{type:'select'}},14);
 assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/>15<\/text>/);
 assert.ok(compactKeyText('a'.repeat(200)).length<=2);
 assert.ok(compactKeyText('音'.repeat(200),12,1)[0].length<=12);
});

test('LCD priorities keep enabled labels and symbols legible across modes and selection states',async()=>{
 const {keyAppearance}=await import('../Source/ControlSurface/key-image.mjs');
 const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const all=modes.flatMap(mode=>buildPads({...createDeckState(),mode}));
 for(const pad of all)for(const pressed of [false,true]){
  const appearance=keyAppearance({...pad,enabled:true,pressed});
  assert.ok(contrast(appearance.ink,appearance.background)>=4.5,`${pad.label}: label contrast`);
  if(!pressed)assert.ok(contrast(appearance.accent,appearance.background)>=3,`${pad.label}: symbol contrast`);
 }
 const primary=type=>keyAppearance({command:{type},enabled:true});
 assert.equal(primary('play').priority,'primary');assert.equal(primary('stop').priority,'primary');
 assert.equal(primary('back5').priority,'transport');assert.equal(primary('save').priority,'utility');
 assert.equal(keyAppearance({command:{type:'mute'},enabled:true,pressed:true}).priority,'selected');
 assert.equal(keyAppearance({command:{type:'mute'},enabled:false,pressed:true}).priority,'disabled');
});

test('disabled keys retain their symbol geometry but use neutral colors and reject commands',()=>{
 for(const type of ['play','stop','home']){
  const pad={label:type,command:{type},enabled:true};
  const disabled=renderKeySvg({...pad,enabled:false}),enabled=renderKeySvg(pad);
  assert.notEqual(disabled,enabled);
  const geometry=svg=>[...svg.matchAll(/(?:d|transform|x|y|width|height|rx)="([^"]*)"/g)].map(m=>m[0]);
  assert.deepEqual(geometry(disabled),geometry(enabled));
  assert.match(disabled,/#858B93/);
 }
 const state=createDeckState();
 assert.equal(commandForPad(state,7),null);
 assert.match(renderKeySvg(buildPads(state)[7]),/#858B93/);
});
