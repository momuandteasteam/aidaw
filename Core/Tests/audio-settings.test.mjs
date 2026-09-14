import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
test('audio outputs refresh while settings are open without losing preferences or applying stale responses',async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout}=await promisify(execFile)(require('electron'),[fileURLToPath(new URL('./audio-settings-browser.cjs',import.meta.url))],{env,timeout:20000});
 const result=JSON.parse(stdout.split('\n').find(l=>l.startsWith('AUDIO_SETTINGS_RESULT ')).slice('AUDIO_SETTINGS_RESULT '.length));
 for(const [name,value]of Object.entries(result))assert.equal(value,true,name);
});
