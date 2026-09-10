import test from 'node:test';import assert from 'node:assert/strict';import {join}from'node:path';import{fixture,seed,track,wave}from'./helpers.mjs';import{writeFile}from'node:fs/promises';import{massiveXStateFromNks,juceBase64}from'../dist/nks.js';
test('NKS parser rejects truncated and foreign preset containers',async t=>{const{root}=await fixture(t);const p=join(root,'bad.nksf');await writeFile(p,Buffer.from('RIFF'));await assert.rejects(massiveXStateFromNks(p),/complete NKS/);const b=Buffer.alloc(24);b.write('RIFF');b.writeUInt32LE(16,4);b.write('NIKS',8);b.write('PCHK',12);b.writeUInt32LE(9999,16);await writeFile(p,b);await assert.rejects(massiveXStateFromNks(p),/Invalid NKS/);assert.equal(juceBase64(Buffer.from([0,255,1])),'3..7e.');});
test('installed MASSIVE retains controller changes after state capture', {skip:!process.env.AIDAW_TEST_NI},async t=>{const{api}=await fixture(t);const scan=await api('catalog_scan',{format:'VST3',location:process.env.AIDAW_MASSIVE??'/Library/Audio/Plug-Ins/VST3/Massive.vst3'});const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};const saved=await api('plugin_preset_save',{plugin:{...plugin,parameters:[{id:'11',value:0},{id:'24',value:1},{id:'97',value:.002}]},name:'Noise state regression'});const info=await api('plugin_inspect',{plugin:{...plugin,preset_id:saved.id},offset:0,limit:100});assert.equal(info.parameters.find(x=>x.id==='11').value,0);assert.equal(info.parameters.find(x=>x.id==='24').value,1);});
test('installed MASSIVE X NKS state produces audio in an isolated worker',{skip:!process.env.AIDAW_TEST_NI,timeout:90000},async t=>{const{api,service}=await fixture(t);const scan=await api('catalog_scan',{format:'VST3',location:process.env.AIDAW_MASSIVE_X??'/Library/Audio/Plug-Ins/VST3/Massive X.vst3'});const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};const preset=await api('massive_x_preset_import',{plugin,path:process.env.AIDAW_MASSIVE_X_PRESET??'/Library/Application Support/Native Instruments/Massive X/Presets/Prime Lead.nksf',name:'Prime Lead test'});await api('project_create',{project_id:'x',name:'X test',bpm:128,length_ticks:3840});await api('project_apply',{project_id:'x',base_revision:0,request_id:'a',operations:[{op:'add_track',track:{id:'x',name:'x',instrument:{...plugin,preset_id:preset.id},gain_db:-18,notes:[{id:'n',tick:960,pitch:65,duration:480,velocity:100}]}}]});const job=await api('render_start',{project_id:'x'});const r=await service.wait(job.job_id);assert.equal(r.state,'succeeded',r.error);assert.ok(r.analysis.sample_peak>.001);assert.equal(r.analysis.clipped_samples,0);});
test('installed Kontakt imports NKI/NKSN, restores state and renders audio',{skip:!process.env.AIDAW_TEST_KONTAKT,timeout:240000},async t=>{const{api,service}=await fixture(t);const scan=await api('catalog_scan',{format:'VST3',location:process.env.AIDAW_KONTAKT??'C:\\Program Files\\Common Files\\VST3\\Kontakt 8.vst3'});const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};const preset=await api('kontakt_preset_import',{plugin,path:process.env.AIDAW_KONTAKT_PRESET??'C:\\Users\\Public\\Documents\\Alicias Keys Library\\Snapshots\\Alicias Keys\\Audience Big Concert Hall.nksn',name:'Kontakt state regression',probe_pitch:60});assert.ok(preset.loaded_probe_peak>.001);assert.ok(preset.restored_probe_peak>.001);await api('project_create',{project_id:'kontakt',name:'Kontakt test',bpm:120,length_ticks:1920});await api('project_apply',{project_id:'kontakt',base_revision:0,request_id:'a',operations:[{op:'add_track',track:{id:'piano',name:'Piano',instrument:{...plugin,preset_id:preset.id},gain_db:-12,notes:[{id:'n',tick:0,pitch:60,duration:960,velocity:100}]}}]});const project=await service.read('kontakt');assert.ok(project.tracks[0].instrument.state_base64);const result=await service.wait((await api('render_start',{project_id:'kontakt',tail_seconds:2})).job_id);assert.equal(result.state,'succeeded',result.error);assert.equal(result.analysis.duration_seconds,3);assert.ok(result.analysis.sample_peak>.001);});
test('installed BBE Sonic Maximizer restores an active state and changes audio', {skip:!process.env.AIDAW_TEST_BBE,timeout:120000}, async t=>{
 const {api,service}=await fixture(t);const target=process.platform==='win32'
  ?{format:'VST3',location:process.env.AIDAW_BBE??'C:\\Program Files\\Common Files\\VST3\\BBE Sound\\Sonic Maximizer.vst3'}
  :{format:'AudioUnit',location:process.env.AIDAW_BBE??'AudioUnit:Effects/aufx,SWE1,BBEs'};
 const scan=await api('catalog_scan',target);const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};
 // Sonic Maximizer 4.7.1 reports the active BBE Process switch as normalized value 1
 // (display text "Out"). Value 0 ("In") renders dry, despite the counter-intuitive labels.
 const parameters=[{id:'2',value:.45},{id:'4',value:.16},{id:'5',value:.2},{id:'7',value:1},{id:'8',value:0}];
 const preset=await api('plugin_preset_save',{plugin:{...plugin,parameters},name:'BBE active-state regression'});
 const info=await api('plugin_inspect',{plugin:{...plugin,preset_id:preset.id},offset:0,limit:100});
 for(const p of parameters)assert.ok(Math.abs(info.parameters.find(q=>q.id===p.id).value-p.value)<.001,`BBE parameter ${p.id} was reset`);
 await seed(api,{...track,notes:[{id:'held',tick:0,duration:3840,pitch:69,velocity:100}]});
 const source=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);
 const asset=await api('asset_import',{project_id:'song',path:source.output,role:'source'});const clip={kind:'audio',asset_id:asset.id};
 const batch=await api('batch_render',{project_id:'song',wait:true,tasks:[
  {id:'dry',name:'Dry',clip,tail_seconds:0},
  {id:'active',name:'BBE active',clip,effects:[{...plugin,preset_id:preset.id}],tail_seconds:0},
  {id:'bypassed',name:'BBE bypassed',clip,effects:[{...plugin,preset_id:preset.id,parameters:[{id:'8',value:1}]}],tail_seconds:0},
 ]});assert.equal(batch.state,'succeeded',JSON.stringify(batch));
 const [dry,active,bypassed]=await Promise.all(batch.tasks.map(x=>wave(x.output)));let maximum=0;
 for(let i=0;i<dry.samples.length;++i)maximum=Math.max(maximum,Math.abs(active.samples[i]-dry.samples[i]));
 assert.ok(maximum>1e-5,'restored active state rendered dry');assert.deepEqual(bypassed.samples,dry.samples);
});

test('installed MODO instruments retain the first note through core rendering', {skip:!process.env.AIDAW_TEST_MODO,timeout:90000},async t=>{
 const {api,service}=await fixture(t);
 for(const [id,name,pitch]of [['drum','MODO DRUM',36],['bass','MODO BASS 2',40]]){
  const scan=await api('catalog_scan',{format:'VST3',location:join(process.env.AIDAW_VST3_DIR??'/Library/Audio/Plug-Ins/VST3',name+'.vst3')});
  await api('project_create',{project_id:id,name,bpm:120,length_ticks:3840});
  await api('project_apply',{project_id:id,base_revision:0,request_id:'first',operations:[{op:'add_track',track:{id,name,instrument:{kind:'plugin',plugin_id:scan.plugins[0].plugin_id},gain_db:-12,notes:[{id:'first',tick:0,pitch,duration:960,velocity:110}]}}]});
  const job=await api('render_start',{project_id:id,tail_seconds:0});const result=await service.wait(job.job_id);assert.equal(result.state,'succeeded',result.error);assert.ok(result.analysis.sample_peak>0.001);
  const {wave}=await import('./helpers.mjs');const audio=await wave(result.output);assert.ok(audio.samples.slice(0,12000).some(x=>Math.abs(x)>0.001),'first note missing');assert.equal(audio.samples.length,96000);
 }
});
