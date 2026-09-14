import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {JuceFileWorker} from '../Build/JS/Adapters/node/engine/juce-file-driver.js';
import {buildEncoders} from '../Source/ControlSurface/encoders.mjs';
import {createDeckState} from '../Source/ControlSurface/model.mjs';
import {renderWaveformSvg} from '../Source/ControlSurface/waveform.mjs';
test('prepared PCM changes continuously across the exact native 5 ms crossfade',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aidaw-crossfade-'));t.after(()=>rm(dir,{recursive:true,force:true}));const paths=[];
 for(const [i,value]of [8192,-8192].entries()){const frames=48000,b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);for(let j=44;j<b.length;j+=2)b.writeInt16LE(value,j);paths.push(join(dir,i+'.wav'));await writeFile(paths[i],b);}
 const worker=new JuceFileWorker(resolve('Core/Build/Native/bin/aidaw-engine'),{home:process.cwd()});
 const result=await worker.call({command:'prepared_comparison_probe',prepared_comparison:{paths,slot:0},segments:[{slot:0,blocks:1},{slot:1,blocks:8},{slot:0,blocks:8},{slot:1,path:paths[0],blocks:8}]});
 assert.equal(result.segments[0].first,.25);assert.equal(result.segments[1].last,-.25);assert.equal(result.segments[2].last,.25);
 assert.equal(result.segments[3].last,.25);
 for(const s of result.segments.slice(1))assert.ok(s.max_step<=.5/240+1e-7,JSON.stringify(s));t.diagnostic(JSON.stringify(result));
});
test('only the rightmost volume encoder is assigned by default',()=>{
 for(const kind of ['composition','mastering']){const encoders=buildEncoders({...createDeckState(),document:{kind,mastering:{songs:[]}}});assert.deepEqual(encoders.slice(0,3).map(e=>e.title),['','','']);assert.equal(encoders[3].title,'再生音量');}
});
test('selected waveform identifies its version and levels, with different A/B colours',()=>{
 const svg=slot=>renderWaveformSvg({peaks:[.1,.5,.9],comparison:{slot,label:'Master <2>',meter:{rms:.1,peak:.5}},role:'processed_mix'});
 assert.match(svg('B'),/B · Master &lt;2&gt;/);assert.match(svg('B'),/RMS -20.0 · Peak -6.0 dBFS/);assert.notEqual(svg('A'),svg('B'));
});

import {prepareComparison,comparisonCacheKey} from '../Build/JS/Application/mastering-preview.js';
test('oversized comparisons stay on the bounded live path without starting a render',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aidaw-limit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const doc={id:'p',mastering:{songs:[{id:'s',versions:[{id:'v',duration_frames:'86400000',tail_seconds:0}],comparison:{a:{kind:'version',version_id:'v'},b:{kind:'version',version_id:'v'}}}]}};
 const service={dir:()=>dir,readDocument:async()=>doc,engine:{describe(){throw Error('Should not load engine');}}};assert.equal(await prepareComparison(service,doc,{song_id:'s',comparison:'a'},new AbortController().signal),undefined);
});

test('comparison cache ignores only presentation metadata and invalidates audio changes',()=>{
 const plan={provenance:{id:'p',name:'Song',revision:1},channels:[{id:'s',name:'Track',source:{clip:{start_frame:'0'}},level:{gain_db:0}}],returns:[],master:{processors:[{state_base64:'one'}]}};
 const key=(p=plan,engine='engine',tail=0,source='source')=>comparisonCacheKey(engine,p,tail,source),same=structuredClone(plan);same.provenance.revision=99;same.provenance.name='Renamed';same.channels[0].name='Renamed';assert.equal(key(),key(same));
 const gain=structuredClone(plan);gain.channels[0].level.gain_db=-1;assert.notEqual(key(),key(gain));const fx=structuredClone(plan);fx.master.processors[0].state_base64='two';assert.notEqual(key(),key(fx));assert.notEqual(key(),key(plan,'other'));assert.notEqual(key(),key(plan,'engine',1));assert.notEqual(key(),key(plan,'engine',0,'changed'));
});
