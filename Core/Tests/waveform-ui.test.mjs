import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWaveformSvg} from '../Source/ControlSurface/waveform.mjs';

test('waveform artwork uses measured peaks and elapsed position, never invents missing audio',()=>{
 const svg=renderWaveformSvg({peaks:[0,.5,1,0],positionRatio:.25});
 assert.match(svg,/width="800" height="100" viewBox="0 0 800 100"/);
 assert.match(svg,/data-waveform="measured" d="M300,26V74M500,2V98"/);
 assert.match(svg,/data-elapsed="A" width="200"/);
 assert.match(svg,/data-playhead="200"/);
 for(const input of [{},{peaks:[0,0,0]},{peaks:[1],available:false}])assert.doesNotMatch(renderWaveformSvg(input),/data-waveform/);
});
test('waveform artwork clamps seek endpoints and invalid amplitudes',()=>{
 for(const [ratio,expected] of [[-1,0],[0,0],[1,800],[2,800],[NaN,0]]){
  const svg=renderWaveformSvg({peaks:[NaN,Infinity,-2],positionRatio:ratio});
  assert.match(svg,new RegExp(`data-playhead="${expected}"`));
  assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.match(svg,/V98/);
 }
 const dense=Array(1600).fill(0);dense[1599]=1;
 assert.match(renderWaveformSvg({peaks:dense}),/M799\.5,2V98/);
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

test('A/B names occupy fixed top/bottom rows with right aligned meters and identity-colored elapsed fill',()=>{
 const comparisons=[{slot:'A',label:'Original',meter:{rms:.1,peak:.5}},{slot:'B',label:'Master',selected:true,meter:{rms:.2,peak:.7}}];
 for(const [slot,color]of [['A','#173A66'],['B','#60401B']]){
  const svg=renderWaveformSvg({peaks:[.5,1],positionRatio:.5,comparisons,comparison:comparisons.find(c=>c.slot===slot)});
  assert.match(svg,new RegExp(`data-elapsed="${slot}" width="400" height="100" fill="${color}"`));
  assert.match(svg,/A · Original/);assert.match(svg,/B · Master/);assert.match(svg,/x="788" y="21" text-anchor="end"/);assert.match(svg,/x="788" y="93" text-anchor="end"/);assert.doesNotMatch(svg,/#a6ffe0|#44f4ad/);
 }
});

test('comparison text overlays full-height peaks and uses all space before the meter',()=>{
 const label='Master v2 · Wide / Enhancer+ / Low +0.8 dB';
 const svg=renderWaveformSvg({peaks:[1],comparisons:[{slot:'A',label}],comparison:{slot:'A'},measureText:(text,size)=>text.length*size*.5});
 assert.match(svg,/M400,2V98/);assert.doesNotMatch(svg,/height="28"/);assert.match(svg,/Master v2 · Wide \/ Enhancer/);assert.match(svg,/paint-order="stroke"/);
});

import {audibleStemLayers} from '../Source/ControlSurface/surface-contract.mjs';
test('stem layers follow audible mix rather than selected track, preserving seek',()=>{
 const tracks=['vocals','drums','bass','other'].map(id=>({id,name:id,mute:false,solo:false,gain_db:0}));
 const wave={layers:tracks.map(t=>({track_id:t.id,peaks:[.2,.8]}))};
 const s={projectId:'p',document:{kind:'separation',composition:{tracks}},trackId:'other'};
 let layers=audibleStemLayers(s,wave);assert.equal(layers.filter(l=>l.audible).length,4);
 s.playback={project_id:'p',effective_mix:{tracks:[{track_id:'vocals',mute:true},{track_id:'drums',solo:true,gain_db:-6}]}};
 layers=audibleStemLayers(s,wave);assert.deepEqual(layers.filter(l=>l.audible).map(l=>l.track_id),['drums']);assert.ok(layers[1].gain<.51);
 const svg=renderWaveformSvg({layers,positionRatio:.25});assert.match(svg,/data-stem="drums"/);assert.doesNotMatch(svg,/data-stem="vocals"/);assert.match(svg,/data-playhead="200"/);
 s.playback.effective_mix.tracks.push({track_id:'drums',mute:true});s.playback.effective_mix.tracks[1].mute=true;
 assert.match(renderWaveformSvg({layers:audibleStemLayers(s,wave)}),/data-stem="drums"/);
 s.playback.effective_mix.tracks[1].solo=false;assert.equal(audibleStemLayers(s,wave).find(l=>l.track_id==='drums').audible,false);
 s.playback.project_id='elsewhere';assert.equal(audibleStemLayers(s,wave).filter(l=>l.audible).length,4);
});
