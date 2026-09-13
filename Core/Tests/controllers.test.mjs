import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeckState,buildPads,commandForPad} from '../Source/ControlSurface/model.mjs';
import {getCoreKeyOrder} from '../Source/ControlSurface/key-image.mjs';
import {listControllerProfiles,getControllerProfile,registerController,createControllerAdapter,parseMidiMessage,createMidiAdapter} from '../../Plugins/Controllers/index.mjs';
const state=()=>({...createDeckState(),mode:'listen',monitorGain:-12,document:{kind:'composition'},encoderAssignments:{composition:{1:{rotate:'volume',press:'monitorMute'}}}});

test('MIDI parser rejects system messages and distinguishes note releases',()=>{
 assert.deepEqual(parseMidiMessage(new Uint8Array([0x92,60,127])),{type:'note',channel:2,number:60,value:127,pressed:true});
 assert.equal(parseMidiMessage([0x90,60,0]).pressed,false);
 assert.equal(parseMidiMessage([0x80,60,90]).pressed,false);
 assert.deepEqual(parseMidiMessage([0xb1,10,64]),{type:'cc',channel:1,number:10,value:64,pressed:true});
 for(const data of [[0xf0,1,2],[0xf8],[0x90,128,1],[0x90,60],[0x90,60,1,2],[-1,2,3],null])assert.equal(parseMidiMessage(data),null);
});

test('learned core keys execute on press only and respect live disabled state',()=>{
 const adapter=createControllerAdapter('ableton-push');
 const target={kind:'key',index:7};
 assert.equal(adapter.learn([0x80,48,127],target),null);
 assert.ok(adapter.learn([0x90,48,127],target));
 assert.equal(adapter.handleMidi([0x90,48,127],state()),null,'learning does not leave a held key armed');
 assert.equal(adapter.handleMidi([0x80,48,0],state()),null);
 assert.deepEqual(adapter.handleMidi([0x90,48,127],state()),commandForPad(state(),getCoreKeyOrder(buildPads(state()))[7]));
 assert.equal(adapter.handleMidi([0x90,48,127],state()),null);
 const disabled=createMidiAdapter({mappings:[{source:{type:'note',channel:0,number:49},target:{kind:'key',index:1}}]});
 assert.equal(disabled.handleMidi([0x90,49,127],state()),null,'empty project cannot play');
 assert.equal(disabled.handleMidi([0x91,49,127],state()),null,'channel must match');
 const exported=adapter.getMappings();exported[0].target.index=0;
 assert.equal(adapter.getMappings()[0].target.index,7);
});

test('CC encoders support explicit absolute and relative formats safely',()=>{
 const mapping=mode=>({source:{type:'cc',channel:0,number:21},target:{kind:'encoder',index:1,mode}});
 const relative=createMidiAdapter({mappings:[mapping('relative-twos-complement')]});
 assert.deepEqual(relative.handleMidi([0xb0,21,127],state()),{type:'monitorVolume',delta:-.5});
 assert.deepEqual(relative.handleMidi([0xb0,21,1],state()),{type:'monitorVolume',delta:.5});
 assert.equal(relative.handleMidi([0xb0,21,0],state()),null);
 assert.equal(relative.handleMidi([0xb0,21,1],{...state(),busy:true}),null);
 const offset=createMidiAdapter({mappings:[mapping('relative-binary-offset')]});
 assert.equal(offset.handleMidi([0xb0,21,64],state()),null);
 assert.deepEqual(offset.handleMidi([0xb0,21,65],state()),{type:'monitorVolume',delta:.5});
 const absolute=createMidiAdapter({mappings:[mapping('absolute')]});
 assert.equal(absolute.handleMidi([0xb0,21,100],state()),null);
 assert.deepEqual(absolute.handleMidi([0xb0,21,102],state()),{type:'monitorVolume',delta:1});
 absolute.reset();assert.equal(absolute.handleMidi([0xb0,21,127],state()),null);
 assert.equal(absolute.learn([0x90,20,127],{kind:'encoder',index:1,mode:'absolute'}),null);
 const press=createMidiAdapter({mappings:[mapping('press')]});
 assert.deepEqual(press.handleMidi([0xb0,21,127],state()),{type:'monitorMute'});
 assert.equal(press.handleMidi([0xb0,21,64],state()),null);
 assert.equal(press.handleMidi([0xb0,21,0],state()),null);
 assert.deepEqual(press.handleMidi([0xb0,21,127],state()),{type:'monitorMute'});
});

test('device scripts are separately registered and expose accurate connection requirements',()=>{
 assert.equal(listControllerProfiles().length,5);
 assert.equal(getControllerProfile('stream-deck').status,'adapter_required');
 assert.equal(getControllerProfile('ulanzi').verifiedHardware,false);
 assert.equal(createControllerAdapter('ulanzi').handleControl({kind:'key',index:0},state()),null);
 assert.deepEqual(createControllerAdapter('novation-launch-control').getMappings(),[]);
 assert.equal(getControllerProfile('missing'),null);
 assert.throws(()=>createControllerAdapter('missing'));
 registerController({id:'test-custom',name:'Test custom',transport:'midi',status:'midi_learn_required'},(_profile,options)=>createMidiAdapter(options));
 assert.ok(createControllerAdapter('test-custom').learn([0x90,64,1],{kind:'key',index:3}));
 assert.throws(()=>registerController({id:'test-custom',name:'Duplicate',transport:'midi'},()=>({})));
});
