import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWaveformSvg} from '../Source/ControlSurface/waveform.mjs';

test('waveform artwork uses measured peaks and elapsed position, never invents missing audio',()=>{
 const svg=renderWaveformSvg({peaks:[0,.5,1,0],positionRatio:.25});
 assert.match(svg,/width="800" height="100" viewBox="0 0 800 100"/);
 assert.match(svg,/data-waveform="measured" d="M300,30\.5V69\.5M500,11V89"/);
 assert.match(svg,/clipPath id="elapsed"><rect width="200"/);
 assert.match(svg,/data-playhead="200"/);
 for(const input of [{},{peaks:[0,0,0]},{peaks:[1],available:false}])assert.doesNotMatch(renderWaveformSvg(input),/data-waveform/);
});
test('waveform artwork clamps seek endpoints and invalid amplitudes',()=>{
 for(const [ratio,expected] of [[-1,0],[0,0],[1,800],[2,800],[NaN,0]]){
  const svg=renderWaveformSvg({peaks:[NaN,Infinity,-2],positionRatio:ratio});
  assert.match(svg,new RegExp(`data-playhead="${expected}"`));
  assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.match(svg,/V89/);
 }
 const dense=Array(1600).fill(0);dense[1599]=1;
 assert.match(renderWaveformSvg({peaks:dense}),/M799\.5,11V89/);
});
test('waveform parameter overlay is optional, concise, and XML escaped',()=>{
 assert.doesNotMatch(renderWaveformSvg({peaks:[.3]}),/data-overlay/);
 const svg=renderWaveformSvg({overlay:{title:'<Gain & "Pan">',value:"+1 'dB'"}});
 assert.match(svg,/data-overlay="parameter"/);
 assert.match(svg,/&lt;Gain &amp; &quot;Pan&quot;&gt;/);
 assert.match(svg,/\+1 &apos;dB&apos;/);
 assert.doesNotMatch(svg,/<Gain/);
 assert.match(renderWaveformSvg({overlay:{title:'a'.repeat(100),value:'b'.repeat(100)}}),/a{41}…/);
});
