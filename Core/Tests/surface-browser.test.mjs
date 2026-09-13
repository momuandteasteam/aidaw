import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),run=promisify(execFile);
test('both shipped skins mount and dispatch in Chromium and switching preserves the live session',async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=await run(require('electron'),[fileURLToPath(new URL('./surface-browser.cjs',import.meta.url))],{env,timeout:20000});
 const line=result.stdout.split('\n').find(line=>line.startsWith('SURFACE_RESULT '));assert.ok(line,result.stdout+result.stderr);const data=JSON.parse(line.slice(15));
 assert.equal(data.kindInitial,'楽曲作成');assert.equal(data.kindEmpty,true);assert.equal(data.kindSeparation,'ステム分離');assert.equal(data.kindMastering,'マスタリング');
 assert.equal(data.tempoInitial,'120 BPM');assert.equal(data.tempoEmpty,true);assert.equal(data.tempoUpdated,'98.5 BPM');assert.equal(data.tempoTransport,'120 BPM');
 assert.equal(data.disabledHidden,true);assert.equal(data.emptyKnobs,false);assert.equal(data.emptyDeck,false);assert.equal(data.emptyPanel,false);assert.deepEqual(data.visibleCells,['1','2','3','4']);assert.equal(data.visibleKeys.length,15);
 assert.equal(data.deckCount,15);assert.equal(data.knobs,4);assert.equal(data.minimalCount,5);assert.equal(data.sameSession,true);assert.equal(data.deckAgain,15);assert.equal(data.remaining,0);assert.deepEqual(data.errors,[]);assert.ok(data.calls.some(c=>c.name==='playback_seek'));assert.ok(data.calls.some(c=>c.name==='playback_set_volume'&&c.args.gain_db===-18));
});
