import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,seed,track,wave} from './helpers.mjs';
import {installStarter,unpackBank} from '../scripts/setup/starter.mjs';
const build=resolve('build');
async function plugin(api,name){const scan=await api('catalog_scan',{format:'VST3',location:join(build,`aidaw-starter-${name.toLowerCase()}_artefacts/Release/VST3/AIDAW ${name}.vst3`)});const s={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};const info=await api('plugin_inspect',{plugin:s});return {s,info,param:(name,value)=>{const p=info.parameters.find(p=>p.name===name);assert.ok(p,name);return {id:p.id,value};}};}
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
test('limiter links stereo, enforces sample ceiling and compensates five ms latency',async t=>{
 const {api,service}=await fixture(t);const lim=await plugin(api,'Limiter');await seed(api,{...track,gain_db:0,notes:[{id:'tone',tick:0,duration:3840,pitch:69,velocity:100}]});
 const dry=await render(api,service,0);
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'unity',operations:[{op:'set_master_effects',effects:[lim.s]}]});
 const unity=await render(api,service,0);assert.equal(unity.sha256,dry.sha256);assert.equal(unity.latency_compensation.trimmed_samples,240);
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
