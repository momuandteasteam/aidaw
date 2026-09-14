import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,seed,track,wave} from './helpers.mjs';
import {installStarter,unpackBank} from '../Tools/setup/starter.mjs';
const build=resolve('Core/Build/Native');
async function plugin(api,name){const scan=await api('catalog_scan',{format:'VST3',location:join(build,`starter/aidaw-starter-${name.toLowerCase()}_artefacts/Release/VST3/AIDAW ${name}.vst3`)});const s={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};const info=await api('plugin_inspect',{plugin:s});return {s,info,param:(name,value)=>{const p=info.parameters.find(p=>p.name===name);assert.ok(p,name);return {id:p.id,value};}};}
async function render(api,service,tail=1){const j=await api('render_start',{project_id:'song',tail_seconds:tail});const r=await service.wait(j.job_id);assert.equal(r.state,'succeeded',r.error);return r;}
test('starter installer reuses verified bank offline and rejects corrupt downloads without publishing',async t=>{
 const result=await installStarter(build,{fetcher:()=>{throw Error('Unexpected network');}});assert.equal(result.reused,true);
 assert.throws(()=>unpackBank(Buffer.from('corrupt')),/checksum/);
 const root=await mkdtemp(join(tmpdir(),'aidaw-starter-install-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await assert.rejects(installStarter(root,{fetcher:async()=>new Response(Buffer.from('broken'))}),/checksum/);
 await assert.rejects(readFile(join(root,'starter-assets/FluidR3_GM.sf2')),/ENOENT/);
});
test('GM programs, four parts, EQ, limiter and separate wet reverb stem render without commercial plugins',async t=>{
 const {api,service}=await fixture(t);const gm=await plugin(api,'GM');
 assert.equal(gm.info.program_count,128);assert.ok(gm.info.programs.every(p=>p.name.length>0));
 const eq=await plugin(api,'EQ'),lim=await plugin(api,'Limiter'),verb=await plugin(api,'Reverb');
 await api('project_create',{project_id:'song',name:'Standard pack check',bpm:120,length_ticks:7680});
 const parts=[['piano',0,60,1],['bass',33,36,1],['guitar',24,67,1],['drums',0,36,10]];
 await api('project_apply',{project_id:'song',base_revision:0,request_id:'arrange',operations:[
  {op:'set_buses',buses:[{id:'space',name:'Reverb return',effects:[verb.s],gain_db:-12}]},
  ...parts.map(([id,program,pitch,channel])=>({op:'add_track',track:{id,name:id,instrument:{...gm.s,program},gain_db:-9,notes:[0,960,1920,2880,3840,4800,5760].map((tick,i)=>({id:`${id}-${i}`,tick,duration:500,pitch,channel,velocity:90})),sends:id==='bass'?[]:[{bus_id:'space',gain_db:-12}]}})),
  {op:'set_master_effects',effects:[{...eq.s,parameters:[eq.param('Low shelf dB',20/36),eq.param('Mid bell dB',16/36)]},lim.s]},
 ]});
 const r=await render(api,service,4);assert.ok(r.analysis.sample_peak>0.001);assert.ok(r.analysis.sample_peak<0.892);assert.equal(r.analysis.frames,384000);
 const again=await render(api,service,4);assert.equal(again.sha256,r.sha256);
 assert.ok(r.mixer);assert.ok(Object.keys(r.stems).some(k=>k.includes('space')));
 for(const stem of Object.values(r.stems))assert.ok(stem.analysis.sample_peak>1e-5,'Each part and FX return must sound');
 for(const [id,program] of parts){const saved=(await service.read('song')).tracks.find(t=>t.id===id);const restored=await api('plugin_inspect',{plugin:{...saved.instrument,parameters:[],program:undefined}});assert.ok(Math.abs(restored.parameters.find(p=>p.name==='GM Program (0-127)').value-program/127)<1e-5);}
 assert.ok((await service.read('song')).tracks.every(t=>t.instrument.state_base64));
});
test('EQ boosts sub bass and cuts low mids in actual rendered samples',async t=>{
 const {api,service}=await fixture(t);const eq=await plugin(api,'EQ');
 await seed(api,{...track,gain_db:0,notes:[{id:'tone',tick:0,duration:3840,pitch:31,velocity:100}]});
 const dry=await render(api,service,0);const rms=async p=>{const {samples}=await wave(p);const slice=samples.slice(12000,72000);return Math.sqrt(slice.reduce((s,x)=>s+x*x,0)/slice.length);};
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'low',operations:[{op:'set_master_effects',effects:[{...eq.s,parameters:[eq.param('Low shelf dB',24/36)]}]}]});
 const low=await render(api,service,0);assert.ok(await rms(low.output)/await rms(dry.output)>1.65);
 await api('project_apply',{project_id:'song',base_revision:2,request_id:'mid',operations:[{op:'replace_notes',track_id:'keys',notes:[{id:'mid',tick:0,duration:3840,pitch:62,velocity:100}]},{op:'set_master_effects',effects:[]}]});
 const midDry=await render(api,service,0);
 await api('project_apply',{project_id:'song',base_revision:3,request_id:'cut',operations:[{op:'set_master_effects',effects:[{...eq.s,parameters:[eq.param('Mid bell dB',12/36)]}]}]});
 const cut=await render(api,service,0);assert.ok(await rms(cut.output)/await rms(midDry.output)<0.55);
});
test('oversampled limiter enforces sample ceiling and compensates its reported latency',async t=>{
 const {api,service}=await fixture(t);const lim=await plugin(api,'Limiter');await seed(api,{...track,gain_db:0,notes:[{id:'tone',tick:0,duration:3840,pitch:69,velocity:100}]});
 const dry=await render(api,service,0);
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'unity',operations:[{op:'set_master_effects',effects:[lim.s]}]});
 const unity=await render(api,service,0);const dryWave=await wave(dry.output),wetWave=await wave(unity.output);let error=0,count=0;for(let i=4096;i<dryWave.samples.length-4096;i++){error+=(dryWave.samples[i]-wetWave.samples[i])**2;count++;}assert.ok(Math.sqrt(error/count)<.001,'Transparent below threshold after latency compensation');assert.ok(unity.latency_compensation.trimmed_samples>240&&unity.latency_compensation.trimmed_samples<1000);
 await api('project_apply',{project_id:'song',base_revision:2,request_id:'drive',operations:[{op:'set_master_effects',effects:[{...lim.s,parameters:[lim.param('Drive dB',1),lim.param('Ceiling dBFS',9/12)]}]}]});
 const loud=await render(api,service,0);assert.ok(loud.analysis.sample_peak<=Math.pow(10,-3/20)+1e-6);assert.ok(loud.analysis.sample_peak>0.6);
});
test('100% wet reverb contains a stereo decay and no immediate dry signal',async t=>{
 const {api,service}=await fixture(t);const verb=await plugin(api,'Reverb');
 await seed(api,{...track,gain_db:0,notes:[{id:'short',tick:0,duration:50,pitch:69,velocity:100}]});
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'wet',operations:[{op:'set_master_effects',effects:[verb.s]}]});
 const wet=await render(api,service,4);const w=await wave(wet.output);
 assert.ok(w.samples.slice(0,200).every(x=>Math.abs(x)<1e-6));assert.ok(w.samples.slice(10000,48000).some(x=>Math.abs(x)>1e-5));
 const b=w.bytes;let data;for(let i=12;i+8<=b.length;){const n=b.readUInt32LE(i+4);if(b.toString('ascii',i,i+4)==='data')data=b.subarray(i+8,i+8+n);i+=8+n+(n%2);}
 let side=0;for(let i=0;i<data.length;i+=6)side+=Math.abs(data.readIntLE(i,3)-data.readIntLE(i+3,3));assert.ok(side>10000);
 assert.ok(w.samples.slice(-4800).every(x=>Math.abs(x)<1e-4));
});

test('eight-band EQ and new effects expose stable parameters, restore state and render',async t=>{
 const {api,service}=await fixture(t),eq=await plugin(api,'EQ'),ex=await plugin(api,'Enhancer'),im=await plugin(api,'Imager');
 assert.equal(eq.info.parameters.filter(p=>p.name!=='Bypass').length,22);for(let band=3;band<=7;band++)assert.ok(eq.info.parameters.some(p=>p.name==='Band '+band+' Q'));
 await seed(api,{...track,gain_db:-6});
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'new-fx',operations:[{op:'set_master_effects',effects:[{...eq.s,parameters:[eq.param('Band 3 dB',.6)]},{...ex.s,parameters:[ex.param('Process',.2),ex.param('Low contour',.11)]},{...im.s,parameters:[im.param('Width',.75),im.param('Bass width',0)]}]}]});
 const a=await render(api,service,0),b=await render(api,service,0);assert.equal(a.sha256,b.sha256);assert.ok(a.analysis.sample_peak>.001);
 const saved=(await service.read('song')).master_effects;for(const [i,spec]of saved.entries()){assert.ok(spec.state_base64);assert.equal(spec.plugin_version,'0.0.1');}
 const restored=await api('plugin_inspect',{plugin:saved[1]});assert.ok(Math.abs(restored.parameters.find(p=>p.name==='Process').value-.2)<1e-5);
});

test('BassMono is a dedicated zero-latency effect with restorable controls',async t=>{
 const {api,service}=await fixture(t),bm=await plugin(api,'BassMono');
 assert.equal(bm.info.parameters.filter(p=>p.name!=='Bypass').length,2);
 await seed(api,{...track,gain_db:-6});
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'bass-mono',operations:[{op:'set_master_effects',effects:[{...bm.s,parameters:[bm.param('Mono cutoff Hz',.375),bm.param('Mono amount',.8)]}]}]});
 const first=await render(api,service,0),again=await render(api,service,0);assert.equal(first.sha256,again.sha256);assert.equal(first.latency_compensation.trimmed_samples,0);assert.ok(first.analysis.sample_peak>.001);
 const saved=(await service.read('song')).master_effects[0];assert.equal(saved.plugin_version,'0.0.1');assert.ok(saved.state_base64);
 const restored=await api('plugin_inspect',{plugin:saved});for(const [name,value] of [['Mono cutoff Hz',.375],['Mono amount',.8]])assert.ok(Math.abs(restored.parameters.find(p=>p.name===name).value-value)<1e-5);
});
