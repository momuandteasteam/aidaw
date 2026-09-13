import test from 'node:test';
import assert from 'node:assert/strict';
import {actionCatalogue,applyCustomLayout,validateLayout,layoutKey} from '../Source/ControlSurface/layout-customization.mjs';
const order=[0,7,2,3,8,1,4,5,6,9,11,12,13,14,10];
const state=()=>({mode:'listen',page:0,document:{kind:'composition',composition:{tracks:[{id:'t1'},{id:'t2'}]}},trackId:'t1',playback:{state:'playing'}});
function pads(s=state()){
 const ids=['play','home','back5','forward5','navigate:tracks','navigate:export','navigate:listen','stop','mute','solo','audition','selectRelative:track:previous','selectRelative:track:next','save','navigate:history'];
 const catalogue=new Map(actionCatalogue(s).map(x=>[x.id,x]));
 return ids.map((id,i)=>({...catalogue.get(id),id:`pad-${i+1}`,core:i<8}));
}
test('all fifteen slots can be cleared and independently reassigned without required mode keys',()=>{
 const p=pads(),options={pads:p,physicalOrder:order};
 const empty=Object.fromEntries(p.map((_,i)=>[i,'none']));
 assert.equal(validateLayout('listen',empty,options),null);
 const cleared=applyCustomLayout({...state(),customLayouts:{'composition:listen':empty}},p);
 assert.ok(cleared.every(p=>p.command===null&&!p.enabled&&p.label===''));
 for(let i=0;i<15;i++)assert.equal(validateLayout('listen',{...empty,[i]:'play'},options),null);
 assert.equal(actionCatalogue(state()).some(a=>a.id==='navigate:modes'),false);
});
test('custom layout is scoped by project kind and only main modes are editable',()=>{
 const s=state(),p=pads(s);s.customLayouts={'composition:listen':{'4':'save'},'mastering:listen':{'4':'openFile'}};
 assert.equal(layoutKey(s),'composition:listen');
 assert.equal(applyCustomLayout(s,p,{physicalOrder:order})[4].command.type,'save');
 assert.equal(applyCustomLayout({...s,document:{kind:'mastering'}},p,{physicalOrder:order})[4].command.type,'openFile');
 for(const mode of ['library','tracklist','versionlist','export'])assert.match(validateLayout(mode,{}),/固定/);
 const list={...s,mode:'tracklist',customLayouts:{'composition:tracklist':{'0':'save'}}};
 assert.equal(applyCustomLayout(list,p),p);
});
test('invalid preferences cannot inject commands or mutate baseline pads',()=>{
 const s=state(),p=pads(s),before=structuredClone(p);
 for(const overrides of [{'15':'save'},{'01':'save'},{'0':{type:'run',code:'bad'}},{'0':'unknown'}]){
  assert.ok(validateLayout('listen',overrides,{pads:p}));
  assert.equal(applyCustomLayout({...s,customLayouts:{'composition:listen':overrides}},p),p);
 }
 const custom=applyCustomLayout({...s,customLayouts:{'composition:listen':{'4':'save'}}},p);
 assert.deepEqual(p,before);assert.equal(custom[4].id,'pad-5');assert.equal(custom[4].core,true);assert.equal(custom[4].customActionId,'save');
});
test('catalogue uses runtime candidate state and keeps transport/mixer unavailable without a target',()=>{
 const empty=actionCatalogue({});
 for(const id of ['play','stop','mute','solo','assignA','switchB'])assert.equal(empty.find(x=>x.id===id).enabled,false,id);
 const s=state();
 const candidate={command:{type:'mute'},label:'Lead mute',enabled:false,pressed:true};
 const mute=actionCatalogue(s,[candidate]).find(x=>x.id==='mute');assert.equal(mute.label,'Lead mute');assert.equal(mute.enabled,false);assert.equal(mute.pressed,true);
 const busy=actionCatalogue({...s,busy:true});assert.equal(busy.find(x=>x.id==='play').enabled,false);assert.equal(busy.find(x=>x.id==='stop').enabled,true);assert.equal(busy.find(x=>x.id==='navigate:listen').enabled,true);
});
test('song and version navigation bounds follow album order and selected version',()=>{
 const s={mode:'listen',songId:'a',versionId:'v2',document:{kind:'mastering',mastering:{song_order:['b','a'],songs:[{id:'a',versions:[{id:'v1'},{id:'v2'}],comparison:{a:{version_id:'v1'}}},{id:'b',versions:[]}]}}};
 const catalogue=new Map(actionCatalogue(s).map(x=>[x.id,x]));
 assert.equal(catalogue.get('listenSong:previous').enabled,true);assert.equal(catalogue.get('listenSong:next').enabled,false);
 assert.equal(catalogue.get('selectRelative:version:previous').enabled,false);assert.equal(catalogue.get('selectRelative:version:next').enabled,true);
 assert.equal(catalogue.get('switchA').enabled,true);assert.equal(catalogue.get('switchB').enabled,false);
});
test('combined stop/home assignment follows live state at any saved button position',()=>{
 for(const playback of [null,...['playing','paused','queued','starting','stopped','completed','failed','cancelled'].map(state=>({state}))]){
  const active=playback&&['playing','paused','queued','starting'].includes(playback.state);
  const s={...state(),playback,customLayouts:{'composition:listen':{'14':'stopOrHome'}}};
  const assigned=applyCustomLayout(s,pads(s))[14];
  assert.equal(assigned.command.type,active?'stop':'home');assert.equal(assigned.label,active?'停止':'先頭へ');
  assert.equal(assigned.customActionId,'stopOrHome');assert.equal(assigned.enabled,true);
  if(active)assert.equal(applyCustomLayout({...s,busy:true},pads(s))[14].enabled,true);
 }
});
