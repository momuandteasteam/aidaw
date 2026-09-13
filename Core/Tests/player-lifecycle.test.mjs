import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Engine} from '../Build/JS/Adapters/node/engine/engine.js';

const run=promisify(execFile);
test('playback failure cancels readiness polling and lets the host exit promptly',async()=>{
 // Node used as a deliberately invalid engine exits when it parses the JSON
 // request as JavaScript. No audio processing or platform-specific executable.
 const source=`
 import {mkdtemp,rm} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import {join} from 'node:path';
 import {JuceFileDriver} from ${JSON.stringify(new URL('../Build/JS/Adapters/node/engine/juce-file-driver.js',import.meta.url).href)};
 import {audioPlan} from ${JSON.stringify(new URL('../Build/JS/Contracts/engine-contracts.js',import.meta.url).href)};
 const dir=await mkdtemp(join(tmpdir(),'aidaw-player-lifecycle-'));
 try {
   const worker=await new JuceFileDriver(process.execPath).startPlayback({plan:audioPlan({}),start_frame:'0',tail_seconds:0,loop:false,loop_start_frame:'0',loop_end_frame:'0',output_device:'',monitor_gain_db:0},{workDir:dir});
   const [ready,done]=await Promise.allSettled([worker.ready,worker.done]);
   if(ready.status!=='rejected'||done.status!=='rejected')throw Error('Worker failure was hidden');
   await worker.control({action:'set_mix',changes:[{track_id:'missing',mute:true}]}).then(()=>{throw Error('Finished player accepted a command');},()=>{});
   console.log('settled');
 } finally { await rm(dir,{recursive:true,force:true}); }
 `;
 const result=await run(process.execPath,['--input-type=module','-e',source],{timeout:5000});
 assert.match(result.stdout,/settled/);
});
test('already-cancelled playback never starts a worker',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(new Engine('missing-engine').startPlayback({}, {signal:controller.signal}),/Playback cancelled/);
});
