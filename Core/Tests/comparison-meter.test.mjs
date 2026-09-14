import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('native comparison meter measures known stereo signals without a device',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aidaw-meter-'));t.after(()=>rm(dir,{recursive:true,force:true}));const run=promisify(execFile),binary=join(dir,'meter');
 await run(process.env.CXX??'c++',['-std=c++20','Core/Tests/Native/ComparisonMeterTest.cpp','-o',binary]);const result=await run(binary);t.diagnostic(result.stdout.trim());
});
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {Engine} from '../Build/JS/Adapters/node/engine/engine.js';
import {audioPlan} from '../Build/JS/Contracts/audio-plan.js';
test('real device starts paused, acknowledges a stable stop frame and meters before muted monitor',{skip:process.env.AIDAW_TEST_PLAYBACK!=='1',timeout:15000},async t=>{
 const engine=new Engine(resolve('Core/Build/Native/bin/aidaw-engine'));t.after(()=>engine.close());
 const graph={id:'meter',name:'Meter',revision:0,sample_rate:48000,ppq:960,bpm:120,meter:[4,4],length_ticks:38400,duration_frames:'480000',tracks:[{id:'tone',instrument:{kind:'builtin',sound:'sine'},gain_db:-6,notes:[{id:'note',tick:0,duration:38400,pitch:69,velocity:64}]}]};
 const player=await engine.startPlayback({plan:audioPlan(graph),start_frame:'0',start_paused:true,tail_seconds:0,loop:false,loop_start_frame:'0',loop_end_frame:'0',output_device:'',monitor_gain_db:-96});t.after(()=>player.close());
 assert.equal((await player.ready).state,'paused');await new Promise(r=>setTimeout(r,120));assert.equal((await player.status()).position_frame,'0');
 await player.control({action:'resume'});await new Promise(r=>setTimeout(r,700));let status=await player.status();assert.equal(status.monitor_gain_db,-96);assert.ok(status.comparison_meter.available);assert.ok(status.comparison_meter.rms>0);assert.ok(status.comparison_meter.sample_peak>0);
 await player.control({action:'stop'});status=await player.done;const frame=status.position_frame;await new Promise(r=>setTimeout(r,100));assert.equal((await player.status()).position_frame,frame);assert.equal(status.state,'stopped');t.diagnostic(`Muted device: RMS ${status.comparison_meter.rms}, stop frame ${frame}`);
});
