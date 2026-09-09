import test from 'node:test';
import assert from 'node:assert/strict';
import { join,resolve } from 'node:path';
import { readFile,writeFile,readdir,rm } from 'node:fs/promises';
import { unzipSync,zipSync } from 'fflate';
import { fixture,seed,track,wave } from './helpers.mjs';
function samples(bytes){let format,data;for(let i=12;i+8<=bytes.length;){const n=bytes.readUInt32LE(i+4),tag=bytes.toString('ascii',i,i+4);if(tag==='fmt ')format=bytes.subarray(i+8,i+8+n);if(tag==='data')data=bytes.subarray(i+8,i+8+n);i+=8+n+(n%2);}const bits=format.readUInt16LE(14),channels=format.readUInt16LE(2);const result=[];for(let i=0;i<data.length;i+=channels*bits/8)result.push(bits===32?data.readFloatLE(i):data.readIntLE(i,3)/8388608);return result;}
test('source audio is immutable, references are rejected, and a local fade changes only its window',async t=>{
 const {api,service}=await fixture(t);await seed(api,{...track,notes:[{id:'whole',tick:0,duration:3840,pitch:69,velocity:100}]});const source=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);
 await api('project_create',{project_id:'master',name:'Source audio processing',length_ticks:1,duration_frames:String(source.analysis.frames)});
 const asset=await api('asset_import',{project_id:'master',path:source.output,role:'source'});const reference=await api('asset_import',{project_id:'master',path:source.output,role:'reference'});
 await assert.rejects(api('project_apply',{project_id:'master',base_revision:0,request_id:'bad-ref',operations:[{op:'add_track',track:{id:'audio',name:'Audio',instrument:{kind:'audio',asset_id:reference.id}}}]}),/Reference/);
 await api('project_apply',{project_id:'master',base_revision:0,request_id:'raw',operations:[{op:'add_track',track:{id:'audio',name:'Audio',instrument:{kind:'audio',asset_id:asset.id}}}]});
 const uncut=await service.wait((await api('render_start',{project_id:'master',tail_seconds:0})).job_id);assert.equal(uncut.state,'succeeded',uncut.error);assert.equal(uncut.analysis.frames,source.analysis.frames);
 const comparison=await service.engine.call({command:'compare_audio',reference:source.output,paths:[uncut.instrument_prints.audio]});assert.equal(comparison.max_absolute_difference,0);
 await api('project_apply',{project_id:'master',base_revision:1,request_id:'local-fade',operations:[{op:'edit_audio_clip',track_id:'audio',changes:{fade_out_frames:'100'}}]});
 const faded=await service.wait((await api('render_start',{project_id:'master',tail_seconds:0})).job_id);assert.equal(faded.state,'succeeded',faded.error);
 const a=samples(await readFile(uncut.instrument_prints.audio)),b=samples(await readFile(faded.instrument_prints.audio));assert.deepEqual(b.slice(0,-101),a.slice(0,-101));assert.equal(Math.abs(b.at(-1)),0);assert.notEqual(a.at(-1),0);
 const report=await api('delivery_publish',{project_id:'master',job_id:faded.id,tags:{title:'Audio'},mp3:false});assert.equal(report.stem_status,'unavailable_from_two_mix');
});
test('shared FX stems reconstruct premaster; portable bundle opens without original plugin catalog',async t=>{
 const {api,service,root}=await fixture(t);await seed(api);
 const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-effect_artefacts/Release/VST3/AIDAW Test Effect.vst3')});
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'bus',operations:[{op:'set_buses',buses:[{id:'reverb',name:'Shared FX',effects:[{kind:'plugin',plugin_id:scan.plugins[0].plugin_id}]}]},{op:'set_track',track_id:'keys',changes:{sends:[{bus_id:'reverb',gain_db:-6}]}}]});
 const job=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);assert.equal(job.state,'succeeded',job.error);assert.ok(job.stems.reverb);
 const compare=await service.engine.call({command:'compare_audio',reference:job.premaster,paths:Object.values(job.stems).map(s=>s.output)});assert.equal(compare.max_absolute_difference,0);
 const bundle=await api('bundle_export',{project_id:'song',job_id:job.id});const entries=unzipSync(await readFile(bundle.output));assert.ok(!Object.keys(entries).some(n=>/^(outputs|jobs|temp)\//.test(n)));
 const again=await api('bundle_export',{project_id:'song',job_id:job.id});assert.equal((await readFile(again.output)).length,(await readFile(bundle.output)).length);
 await api('bundle_import',{project_id:'copied',path:bundle.output});await rm(join(root,'PluginLibrary.aidaw','state','host-catalog.json'));await rm(service.dir('song'),{recursive:true});
 const validation=await api('project_validate',{project_id:'copied'});assert.equal(validation.dependencies_resolved,false);assert.ok(validation.frozen_audio);assert.ok((await wave(validation.frozen_audio)).samples.some(x=>x!==0));
 const bad=join(root,'bad.zip');await writeFile(bad,zipSync({'../escape':Buffer.from('bad')}));await assert.rejects(api('bundle_import',{project_id:'bad',path:bad}),/Unsafe/);
});
test('delivery contains consistent metadata, stems and revision; output recovery restores previous release',async t=>{
 const {api,service}=await fixture(t);await seed(api);const job=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);
 const tags={title:'Example Track',artist:'Example Artist',album:'Example Album',track:1,track_total:12};
 const result=await api('delivery_publish',{project_id:'song',job_id:job.id,tags,mp3:true});const manifest=JSON.parse(await readFile(result.manifest));assert.equal(manifest.revision,1);assert.ok(manifest.files.some(f=>f.path==='MP3/preview.mp3'));assert.ok(manifest.files.some(f=>f.path==='stems/keys__instrument.wav'));
 const output=join(service.dir('song'),'outputs','WAV','master.wav'),original=await readFile(output);
 await writeFile(join(service.dir('song'),'temp','publish.json'),JSON.stringify({entries:[{path:'WAV/master.wav',previous:`jobs/${job.id}/artifacts/audio.wav`}],previous_manifest:manifest}));await writeFile(output,'partial');await api('delivery_recover',{project_id:'song'});assert.deepEqual(await readFile(output),original);
 assert.deepEqual((await readdir(service.dir('song'))).filter(n=>!n.endsWith('.json')).sort(),['assets','jobs','outputs','state','temp']);
});
test('multi-song batch uses one job, preserves complete sources, and resumes completed tasks without new attempts',async t=>{
 const {api,service}=await fixture(t);await seed(api);const input=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);const asset=await api('asset_import',{project_id:'song',path:input.output,role:'source'});
 const before=await readdir(join(service.dir('song'),'jobs'));const batch=await api('batch_render',{project_id:'song',wait:true,tasks:[{id:'a',name:'A',clip:{kind:'audio',asset_id:asset.id},tail_seconds:0},{id:'b',name:'B',clip:{kind:'audio',asset_id:asset.id,timeline_frame:'480'},tail_seconds:0}]});assert.equal(batch.state,'succeeded',JSON.stringify(batch));assert.equal((await readdir(join(service.dir('song'),'jobs'))).length,before.length+1);assert.equal(batch.tasks[0].analysis.frames,input.analysis.frames);assert.equal(batch.tasks[1].analysis.frames,input.analysis.frames+480);
 const resumed=await api('batch_render_resume',{project_id:'song',job_id:batch.id,wait:true});assert.ok(resumed.tasks.every(t=>t.attempt===1));
 const delivered=await api('batch_delivery_publish',{project_id:'song',job_id:batch.id,mp3:false});const released=JSON.parse(await readFile(delivered.manifest));assert.ok(released.files.some(f=>f.path==='WAV/a.wav'));assert.ok(released.files.some(f=>f.path==='WAV/b.wav'));
});
test('effect automation accepts exact frame positions and changes actual audio',async t=>{
 const {api,service}=await fixture(t);await seed(api,{...track,notes:[{id:'held',tick:0,duration:3840,pitch:69,velocity:100}]});const scan=await api('catalog_scan',{format:'VST3',location:resolve('build/aidaw-test-effect_artefacts/Release/VST3/AIDAW Test Effect.vst3')});const plugin={kind:'plugin',plugin_id:scan.plugins[0].plugin_id};const info=await api('plugin_inspect',{plugin});const gain=info.parameters.find(p=>p.name==='Gain').id;
 await api('project_apply',{project_id:'song',base_revision:1,request_id:'effect-motion',operations:[{op:'set_master_effects',effects:[{...plugin,automation:[{parameter_id:gain,interpolation:'hold',points:[{frame:'0',value:0},{frame:'48000',value:1}]}]}]}]});
 const job=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);assert.equal(job.state,'succeeded',job.error);const audio=await wave(job.output);assert.ok(audio.samples.slice(1000,47000).every(x=>x===0));assert.ok(audio.samples.slice(50000).some(x=>Math.abs(x)>.001));
});
test('solo render cannot replace full-project frozen audio or be published as the mix',async t=>{
 const {api,service}=await fixture(t);await seed(api);const full=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0,request_id:'full'})).job_id);
 assert.equal((await api('render_start',{project_id:'song',tail_seconds:0,request_id:'full'})).job_id,full.id);
 const before=(await api('project_validate',{project_id:'song'})).frozen_audio;
 const solo=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0,track_id:'keys'})).job_id);
 await assert.rejects(api('delivery_publish',{project_id:'song',job_id:solo.id,tags:{title:'not mix'},mp3:false}),/successful/);
 assert.equal((await api('project_validate',{project_id:'song'})).frozen_audio,before);
});
test('background batch returns a job and supports normal service cancellation',async t=>{
 const {api,service}=await fixture(t);await seed(api);const input=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);const source=await api('asset_import',{project_id:'song',path:input.output,role:'source'});
 const batch=await api('batch_render',{project_id:'song',tasks:[{id:'one',name:'One',clip:{kind:'audio',asset_id:source.id}}]});assert.ok(batch.job_id);
 const cancelled=await api('job_cancel',{job_id:batch.job_id});assert.equal(cancelled.state,'cancelled');
});

test('failed publication preparation does not alter an existing MIDI delivery',async t=>{
 const {api,service}=await fixture(t);await seed(api);const job=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);
 const midi=join(service.dir('song'),'outputs','MIDI','performance.mid');await writeFile(midi,'previous release');
 const old=process.env.AIDAW_FFMPEG;process.env.AIDAW_FFMPEG=join(service.dir('song'),'missing-ffmpeg');
 try{await assert.rejects(api('delivery_publish',{project_id:'song',job_id:job.id,tags:{title:'Failure'},mp3:true}));assert.equal(await readFile(midi,'utf8'),'previous release');}
 finally{if(old===undefined)delete process.env.AIDAW_FFMPEG;else process.env.AIDAW_FFMPEG=old;}
});

test('batch detects changed source after rendering and resumes missing completed outputs',async t=>{
 const {api,service}=await fixture(t);await seed(api);const input=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);const asset=await api('asset_import',{project_id:'song',path:input.output,role:'source'});
 const args={project_id:'song',wait:true,tasks:[{id:'a',name:'A',clip:{kind:'audio',asset_id:asset.id},tail_seconds:0}]};const first=await api('batch_render',args);assert.equal(first.owner_pid,process.pid);
 const {rm}=await import('node:fs/promises');await rm(first.tasks[0].output);const resumed=await api('batch_render_resume',{project_id:'song',job_id:first.id,wait:true});assert.equal(resumed.state,'succeeded');assert.equal(resumed.tasks[0].attempt,2);
 const original=service.engine.call.bind(service.engine);service.engine.call=async(request,options)=>{const result=await original(request,options);if(request.command==='render')await writeFile(join(service.dir('song'),asset.path),'source changed');return result;};
 const bad=await api('batch_render',args);assert.equal(bad.state,'failed');assert.match(bad.tasks[0].error,/hash mismatch/);
});
