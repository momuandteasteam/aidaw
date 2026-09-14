import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
test('native mastering effects meet numerical DSP criteria',{timeout:60000},async t=>{
 const {stdout}=await promisify(execFile)(resolve('Core/Build/Native/bin/aidaw-effect-dsp-tests'+(process.platform==='win32'?'.exe':'')),[],{timeout:55000});t.diagnostic(stdout.trim());
});
