import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
test('Chromium shows A/B selection and waveform overlay inside the square cover',async()=>{
 const {stdout}=await promisify(execFile)(resolve('Core/node_modules/.bin/electron'),[resolve('Core/Tests/mastering-ab-browser.cjs')],{timeout:15000});const result=JSON.parse(stdout.trim().split('\n').at(-1));assert.equal(result.selected,'true');assert.equal(result.meters,0);
});
