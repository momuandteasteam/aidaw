import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
test('assignment settings save and restore button and separate encoder gestures in Chromium',async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout}=await promisify(execFile)(require('electron'),[fileURLToPath(new URL('./assignment-browser.cjs',import.meta.url))],{env,timeout:20000});
 const data=JSON.parse(stdout.split('\n').find(l=>l.startsWith('ASSIGNMENT_RESULT ')).slice(18));
 assert.equal(data.buttons,15);assert.equal(data.knobInputs,8);assert.equal(data.modeHidden,true);
 assert.equal(data.initialCount,3);assert.deepEqual(data.initialTypes,['stop','play','navigate']);
 assert.equal(data.restoredButton,'save');assert.deepEqual(data.remapped,{type:'monitorVolume',delta:1});assert.deepEqual(data.pressed,{type:'monitorMute'});
});
