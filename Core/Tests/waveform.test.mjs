import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,create} from './helpers.mjs';
import {atomicJson} from '../Build/JS/Adapters/node/workspace/storage.js';
import {sha256} from '../Build/JS/Adapters/node/workspace/assets.js';
import {parseDocument} from '../Build/JS/Domain/domain.js';
async function sample(root){
 const frames=48000,bytes=Buffer.alloc(44+frames*4);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(192000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*4,40);
 for(let i=24000;i<frames;i++){bytes.writeInt16LE(16384,44+i*4);bytes.writeInt16LE(-16384,46+i*4);}
 const path=join(root,'source.wav');await writeFile(path,bytes);return {path,hash:await sha256(path),bytes};
}
test('unrendered composition has no invented waveform and does not enter audio queue',async t=>{
 const {service,api}=await fixture(t);await api('project_create',create);
 service.processing.run=()=>{throw Error('Audio queue must not be entered');};
 const result=await api('project_waveform',{project_id:'song'});
 assert.equal(result.available,false);assert.equal(result.reason,'audio_not_generated');
});
test('measured stereo peaks retain anti-phase audio and refuse a stale or tampered mix',async t=>{
 const {root,service,api}=await fixture(t);await api('project_create',create);const audio=await sample(root),dir=service.dir('song');
 const relative=`state/frozen/${audio.hash}.wav`;await mkdir(join(dir,'state/frozen'),{recursive:true});await writeFile(join(dir,relative),audio.bytes);
 await atomicJson(join(dir,'state/frozen.json'),{revision:0,master:relative});
 const before=await readFile(join(dir,'project.json'),'utf8'),result=await api('project_waveform',{project_id:'song',bins:100});
 assert.equal(result.role,'processed_mix');assert.equal(result.duration_frames,'48000');assert.equal(result.peaks.length,100);
 assert.ok(result.peaks.slice(0,50).every(v=>v===0));assert.ok(result.peaks.slice(50).every(v=>Math.abs(v-0.5)<0.001));
 assert.equal(await readFile(join(dir,'project.json'),'utf8'),before);
 await api('project_apply',{project_id:'song',base_revision:0,request_id:'tempo',operations:[{op:'set_bpm',bpm:99}]});
 assert.equal((await api('project_waveform',{project_id:'song'})).available,false);
 assert.equal((await api('project_waveform',{project_id:'song',revision:0})).available,true);
 await writeFile(join(dir,relative),Buffer.alloc(100));
 await assert.rejects(api('project_waveform',{project_id:'song',revision:0}),/hash mismatch/);
});
test('mastering waveform uses real source clip and timeline, without claiming processed effects',async t=>{
 const {root,service,api}=await fixture(t);await api('project_create',{...create,kind:'mastering'});const audio=await sample(root),dir=service.dir('song'),assetId=`${audio.hash}-source`,relative=`assets/source/${audio.hash}.wav`;
 await mkdir(join(dir,'assets/source'),{recursive:true});await writeFile(join(dir,relative),audio.bytes);
 await atomicJson(join(dir,'manifest.json'),{schema_version:1,assets:[{id:assetId,path:relative,sha256:audio.hash,role:'source',name:'Source',parents:[],audio:{sample_rate:48000,frames:48000}}]});
 const v={id:'v1',label:'First',created_at:new Date().toISOString(),created_revision:0,source_asset_id:assetId,source_sha256:audio.hash,clip:{kind:'audio',asset_id:assetId,start_frame:'24000',end_frame:'48000',timeline_frame:'24000'},duration_frames:'48000',input_gain_db:-6};
 const song={id:'track',name:'Track',versions:[v],current_version_id:'v1',comparison:{a:{kind:'source',source_asset_id:assetId},b:{kind:'version',version_id:'v1'}}};
 const doc=parseDocument({schema_version:3,kind:'mastering',id:'song',name:'Album',revision:0,mastering:{song_order:['track'],songs:[song]}});
 await atomicJson(join(dir,'project.json'),{project:doc,receipts:{}});
 const result=await api('project_waveform',{project_id:'song',song_id:'track',comparison:'b',bins:100});
 assert.equal(result.role,'source');assert.equal(result.version_id,'v1');assert.ok(result.peaks.slice(0,50).every(v=>v===0));assert.ok(result.peaks.slice(50).every(v=>Math.abs(v-0.5)<0.001));
 assert.deepEqual(await service.readDocument('song'),doc);
 await assert.rejects(api('project_waveform',{project_id:'song',song_id:'missing'}),/Unknown mastering song/);
});
