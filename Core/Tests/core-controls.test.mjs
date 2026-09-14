import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeckState, commandForPad, reduceDeckState, buildPads, pageCount } from '../Source/ControlSurface/model.mjs';
import { adjustEncoderDraft, encoderTarget, buildEncoders } from '../Source/ControlSurface/encoders.mjs';

const composition = () => ({...createDeckState(), projectId:'song', mode:'transport',trackId:'t0',api:['export_start','playback_set_mix'],document:{schema_version:3,id:'song',kind:'composition',revision:4,name:'Song',composition:{bpm:120,length_ticks:3840,tracks:Array.from({length:131},(_,i)=>({id:`t${i}`,name:`Track ${i}`,gain_db:-6,pan:0,mute:false,solo:false,instrument:{kind:'builtin',sound:'keys'},notes:[{id:'n',pitch:60}]})),buses:[{id:'return',name:'Return',gain_db:-12,pan:0}],master_effects:[]}}});
const mastering = () => ({...createDeckState(),projectId:'album',mode:'mastering',songId:'s0',versionId:'v100',api:['export_start'],document:{schema_version:3,id:'album',kind:'mastering',revision:17,name:'Album',mastering:{song_order:['s0','s1'],songs:[{id:'s0',name:'First',current_version_id:'v100',accepted_version_id:'v55',comparison:{a:{kind:'version',version_id:'v0'},b:{kind:'version',version_id:'v100'}},versions:Array.from({length:101},(_,i)=>({id:`v${i}`,label:`Version ${i}`,input_gain_db:-3,duration_frames:'96000',effects:[{kind:'plugin',plugin_id:'effect',parameters:[{id:'gain',value:.5}]}]}))},{id:'s1',name:'Second',current_version_id:'s1-v0',versions:[{id:'s1-v0',label:'Initial',input_gain_db:0,effects:[]}]}]}}});

/** Search by pressing only a physical core's next key; never inspect shortcut pads. */
function findCoreCommand(initial, matches) {
 let state={...initial,page:0};
 const visited=new Set();
 for(;;){
  assert.ok(!visited.has(state.page),'core pagination must make progress');visited.add(state.page);
  for(let index=0;index<8;++index){const command=commandForPad(state,index);if(command&&matches(command))return {state,command,index};}
  const next=commandForPad(state,4);if(!next)return null;
  assert.deepEqual(next,{type:'page',delta:1});state=reduceDeckState(state,next);
 }
}
const findType=(state,type)=>findCoreCommand(state,command=>command.type===type);
function enter(state,mode){const found=findCoreCommand(state,command=>command.type==='navigate'&&command.mode===mode);assert.ok(found,`${state.mode} must expose ${mode} in the eight-key core`);return reduceDeckState(found.state,found.command);}
function selectionsAcrossCore(initial){
 let state={...initial,page:0};const selected=[];
 for(;;){for(let index=0;index<3;++index){const command=commandForPad(state,index);if(command?.type==='select')selected.push(command.itemId);}const next=commandForPad(state,4);if(!next)break;state=reduceDeckState(state,next);}
 return selected;
}

test('eight keys reach all 131 tracks, mute/solo/audition, gain/pan, and export without shortcut or encoder input',()=>{
 let state=composition();const trackList=enter(state,'tracklist');
 assert.deepEqual(selectionsAcrossCore(trackList),Array.from({length:131},(_,i)=>`t${i}`));
 const chosen=findCoreCommand(trackList,command=>command.type==='select'&&command.itemId==='t130');assert.ok(chosen);
 state=reduceDeckState(state,{type:'patch',patch:{trackId:chosen.command.itemId}});
 state=enter(state,'tracks');for(const type of ['mute','solo','audition','play'])assert.ok(findType(state,type),type);
 const parameters=enter(state,'parameters');
 for(const [parameter,direction]of [['gain_db',-1],['gain_db',1],['pan',-1],['pan',1]]){
  const result=findCoreCommand(parameters,command=>command.type==='adjustParameter'&&command.parameter===parameter&&Math.sign(command.delta)===direction);assert.ok(result,`${parameter} ${direction}`);
 }
 assert.ok(findType(parameters,'commitParameters'));assert.ok(findType(parameters,'discardParameters'));assert.ok(findCoreCommand(parameters,command=>command.type==='resetParameter'&&command.parameter==='pan'));
 const home=reduceDeckState(parameters,commandForPad(parameters,6)),output=enter(home,'export');
 for(const type of ['format:wav','format:mp3','format:flac','export','reviewExport','save','midi'])assert.ok(findType(output,type),type);
});

test('eight keys select any mastering generation, assign A/B independently, edit FX, and choose song or album output',()=>{
 const state=mastering(),history=enter(state,'history'),list=enter(history,'versionlist');
 assert.deepEqual(selectionsAcrossCore(list),Array.from({length:101},(_,i)=>`v${100-i}`));
 const earliest=findCoreCommand(list,command=>command.type==='select'&&command.itemId==='v0');assert.ok(earliest);
 const selected=reduceDeckState(history,{type:'patch',patch:{versionId:earliest.command.itemId}});
 for(const type of ['assignA','assignB','switchA','switchB','editVersion','playSelectedVersion'])assert.ok(findType(selected,type),type);
 assert.equal(state.document.mastering.songs[0].current_version_id,'v100');assert.equal(state.document.mastering.songs[0].accepted_version_id,'v55');
 const chain=enter(state,'chain');assert.ok(findType(chain,'editVersion'));assert.ok(findType(chain,'acceptVersion'));
 const fxList=enter(chain,'fxparameters');fxList.fxParameters=Array.from({length:129},(_,i)=>({id:`p${i}`,name:`Parameter ${i}`,value:.5}));
 assert.equal(selectionsAcrossCore(fxList).at(-1),'p128');
 const fxEdit={...fxList,mode:'fxedit',fxParameterId:'p128'};assert.ok(findCoreCommand(fxEdit,command=>command.type==='adjustFxParameter'&&command.delta<0));assert.ok(findCoreCommand(fxEdit,command=>command.type==='adjustFxParameter'&&command.delta>0));assert.ok(findType(fxEdit,'commitFxParameter'));
 const modes={...state,mode:'modes'},songs=enter(modes,'songs');
 for(const type of ['addSong','exportSong','exportAlbum'])assert.ok(findType(songs,type),type);
 const output=enter(modes,'export');for(const type of ['toggleScope','format:wav','format:mp3','format:flac','export','save'])assert.ok(findType(output,type),type);
});

test('gain and pan adjustments remain drafts on their original track, return, or mastering generation',()=>{
 let state={...composition(),encoderAssignments:{composition:{2:{rotate:'gain',press:'commitParameters'},3:{rotate:'pan',press:'commitParameters'}}}};const original=structuredClone(state.document);
 state=adjustEncoderDraft(state,'gain_db',1);state=adjustEncoderDraft(state,'pan',.2);const first=encoderTarget(state);
 state=reduceDeckState(state,{type:'patch',patch:{trackId:'t1'}});state=adjustEncoderDraft(state,'gain_db',-2);
 assert.equal(buildEncoders(state)[2].valueNumber,-8);
 state=reduceDeckState(state,{type:'patch',patch:{trackId:'t0'}});assert.equal(buildEncoders(state)[2].valueNumber,-5);assert.equal(buildEncoders(state)[3].valueNumber,.2);
 state=reduceDeckState(state,{type:'patch',patch:{trackId:'return'}});state=adjustEncoderDraft(state,'gain_db',2);assert.equal(encoderTarget(state).kind,'bus');assert.equal(buildEncoders(state)[2].valueNumber,-10);
 assert.deepEqual(state.document,original);assert.equal(state.dialDrafts[first.key].target.track_id,'t0');assert.equal(state.dialDrafts[first.key].target.base_revision,4);
 let album={...mastering(),encoderAssignments:{mastering:{2:{rotate:'gain',press:'commitParameters'}}}};const untouched=structuredClone(album.document);album=adjustEncoderDraft(album,'gain_db',.5);
 album=reduceDeckState(album,{type:'patch',patch:{versionId:'v0'}});album=adjustEncoderDraft(album,'gain_db',-1);
 assert.equal(buildEncoders(album)[2].valueNumber,-4);album=reduceDeckState(album,{type:'patch',patch:{versionId:'v100'}});assert.equal(buildEncoders(album)[2].valueNumber,-2.5);
 assert.deepEqual(album.document,untouched);assert.equal(Object.keys(album.dialDrafts).length,2);
});

test('core stop and navigation stay available while a draft commit is pending on any page',()=>{
 for(const initial of [composition(),mastering()])for(const mode of ['transport','tracks','history','parameters','export','fxedit']){
  let state={...initial,mode,busy:true,playback:{playback_id:'live',state:'playing'}};
  for(let page=0;page<pageCount(state);++page){state={...state,page};assert.deepEqual(commandForPad(state,7),{type:'stop'});assert.deepEqual(commandForPad(state,5),{type:'back'});assert.deepEqual(commandForPad(state,6),{type:'navigate',mode:'listen'});
   for(let index=0;index<3;++index){const command=commandForPad(state,index);assert.ok(!command||command.type==='navigate');}
   assert.equal(buildPads(state).length,15);
  }
 }
});

test('composition home has exactly three assigned keys in the requested physical order',()=>{
 const home={...composition(),mode:'listen'},pads=buildPads(home);
 assert.deepEqual([0,7,2].map(i=>pads[i].command.type),['home','play','navigate']);
 assert.equal(pads[2].command.mode,'export');
 assert.equal(pads.filter(p=>p.command).length,3);
 assert.ok(pads.every(p=>p.command?.mode!=='modes'));
 assert.deepEqual(buildEncoders(home).map(e=>e.enabled),[false,false,false,true]);
 assert.equal(buildEncoders(home)[3].title,'再生音量');
 const master=buildPads({...mastering(),mode:'listen'});
 assert.ok(master.every(p=>p.command?.mode!=='modes'));
});
