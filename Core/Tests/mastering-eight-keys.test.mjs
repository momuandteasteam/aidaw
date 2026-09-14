import test from 'node:test';import assert from 'node:assert/strict';
import {createDeckState,buildPads} from '../Source/ControlSurface/model.mjs';import {buildHardwareFrame} from '../Source/ControlSurface/hardware-profile.mjs';import {createControlRuntime} from '../Source/Desktop/runtime/control-runtime.mjs';
const song=id=>({id,name:id,current_version_id:'new',versions:[{id:'old',label:'Original',duration_frames:'48000'},{id:'new',label:'Master',duration_frames:'48000'}],comparison:{a:{kind:'version',version_id:'old'},b:{kind:'version',version_id:'new'}}});
const doc={kind:'mastering',revision:1,mastering:{song_order:['first','last'],songs:[song('first'),song('last')]}};
test('eight hardware and desktop keys keep A/B adjacent and album controls vertical',()=>{
 const state={...createDeckState(),document:doc,projectId:'p',songId:'first',activeSlot:'B'};
 for(const device of ['stream-deck','stream-deck-plus']){const frame=buildHardwareFrame(buildPads(state),device),core=frame.keys.filter(k=>k.column<4&&k.row<2);assert.deepEqual(core.map(k=>k.action.type),['home','play','downloadMaster','moveSong','switchA','switchB','cycleSelected','moveSong']);assert.equal(core[3].action.delta,-1);assert.equal(core[7].action.delta,1);assert.ok(core[2].svg.includes('stroke-linecap="round"'));assert.ok(!core[2].svg.includes('<text x="36" y="33"'));
 }
 const single={...state,document:{...doc,mastering:{song_order:['first'],songs:[song('first')]}}};assert.equal(buildPads(single).filter(p=>p.command?.type==='moveSong'&&p.enabled).length,0);
});
test('album navigation wraps and audio cycling only changes the inactive comparison slot',async()=>{
 const document=structuredClone(doc),calls=[],errors=[];
 const runtime=createControlRuntime({application:{async invoke(name,args){calls.push({name,args});if(name==='project_document')return document;if(name==='mastering_comparison_cycle'){const s=document.mastering.songs.find(s=>s.id===args.song_id);s.comparison[args.slot]={kind:'version',version_id:'old'};document.revision++;return {};}return {}; }},host:{clearMessage(){},async form(){throw Error('Physical controls must not open a dialog');}},onError:e=>errors.push(e)});
 try{runtime.patch({document,projectId:'p',songId:'first',activeSlot:'B',versionId:'new'});await runtime.dispatch({type:'moveSong',delta:-1});assert.equal(runtime.getState().songId,'last');assert.equal(runtime.getState().position,'0');assert.equal(runtime.getState().activeSlot,'B');await runtime.dispatch({type:'moveSong',delta:1});assert.equal(runtime.getState().songId,'first');await runtime.dispatch({type:'cycleSelected'});const request=calls.find(c=>c.name==='mastering_comparison_cycle');assert.equal(request.args.slot,'a');assert.equal(document.mastering.songs[0].comparison.a.version_id,'old');assert.equal(runtime.getState().activeSlot,'B');assert.ok(!calls.some(c=>['playback_stop','playback_switch_mastering'].includes(c.name)));assert.equal(runtime.getState().mode,'listen');assert.deepEqual(errors,[]);}finally{runtime.dispose();}
});

// Labels must remain readable on both comparison colors and all transport states.
import {keyAppearance} from '../Source/ControlSurface/key-image.mjs';
test('mastering active key labels retain minimum contrast',()=>{
 const luminance=hex=>{const c=hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 for(const type of ['home','stop','play','switchA','switchB','cycleSelected','moveSong','downloadMaster'])for(const pressed of [false,true])for(const icon of ['A','B']){
  const p=keyAppearance({command:{type},pressed,icon,enabled:true}),a=luminance(p.background),b=luminance(p.ink);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,type);
 }
});
