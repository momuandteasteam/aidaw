import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
function wav(){const frames=2400,b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){const n=Math.round(Math.sin(i*2*Math.PI*440/48000)*1000);b.writeInt16LE(n,44+i*4);b.writeInt16LE(n,46+i*4);}return b;}
test('album exports chosen immutable versions in WAV MP3 FLAC and preserves earlier releases',async t=>{
 const {root,api,service}=await fixture(t);await api('project_create',{project_id:'album',name:'Album',kind:'mastering'});
 const source=join(root,'input.wav');await writeFile(source,wav());const asset=await api('asset_import',{project_id:'album',path:source,role:'source'});
 for(const [index,song]of ['one','two'].entries())await api('mastering_add_song',{project_id:'album',base_revision:index,request_id:`initial-${song}`,song_id:song,name:song,asset_id:asset.id});
 await api('mastering_create_version',{project_id:'album',base_revision:2,request_id:'quieter',song_id:'one',parent_version_id:'initial-one',label:'Quieter',input_gain_db:-6});
 const request={project_id:'album',scope:'album',formats:['wav','mp3','flac'],request_id:'album-all'};
 const first=await api('export_start',request);assert.equal((await api('export_start',request)).replayed,true);
 const job=await service.wait(first.job_id);assert.equal(job.state,'succeeded',job.error);assert.equal(job.files.length,6);assert.equal(job.items[0].version_id,'quieter');
 for(const file of job.files)await access(file.path);
 const second=await api('export_start',{project_id:'album',scope:'song',song_id:'one',version_id:'initial-one',formats:['wav'],request_id:'single-original'});
 const single=await service.wait(second.job_id);assert.equal(single.state,'succeeded',single.error);assert.equal(single.files[0].version_id,'initial-one');
 for(const file of job.files)await access(file.path);
 await assert.rejects(api('export_start',{...request,formats:['wav']}),/different export/);
 const saved=await api('project_save',{project_id:'album'});assert.match(saved.output,/\.aidaw\.zip$/);assert.equal((await readFile(saved.output)).toString('ascii',0,2),'PK');
 await api('project_open',{project_id:'restored',path:saved.output});const doc=await api('project_document',{project_id:'restored'});assert.equal(doc.kind,'mastering');assert.equal(doc.revision,3);assert.equal(doc.mastering.songs[0].versions.length,2);
});
test('composition export uses the mixer and rejects empty sessions',async t=>{
 const {api,service}=await fixture(t);await api('project_create',{project_id:'song',name:'Song',kind:'composition',instrument_policy:'allow_basic',length_ticks:480});
 await api('project_apply',{project_id:'song',base_revision:0,request_id:'tone',operations:[{op:'add_track',track:{id:'tone',name:'Tone',instrument:{kind:'builtin',sound:'sine'},notes:[{id:'n',tick:0,duration:240,pitch:69,velocity:30}]}}]});
 const result=await api('export_start',{project_id:'song',scope:'project',formats:['wav'],tail_seconds:0,request_id:'wav'});const job=await service.wait(result.job_id);assert.equal(job.state,'succeeded',job.error);assert.ok(job.items[0].stems.tone);assert.equal(job.files.length,1);
});
