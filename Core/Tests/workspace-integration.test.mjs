import { createLocalApplication } from '../Build/JS/Application/local-application.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../Build/JS/Application/service.js';
import { call } from '../Build/JS/Application/api.js';
import { ProcessingQueue } from '../Build/JS/Adapters/node/runtime/processing-queue.js';

async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'aidaw-workspace-'));
 const engine={analyze:async request=>{assert.equal(typeof request.path,'string');return {sample_rate:48000,frames:48000,channels:2};},close:async()=>{}};
 const service=new Service(root,engine);t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const api=(name,args)=>call(createLocalApplication(service),name,args);
 return {root,service,api};
}
test('mastering song versions compile independently and arbitrary historical selection never changes head',async t=>{
 const {root,service,api}=await setup(t);
 await api('project_create',{project_id:'album',kind:'mastering',name:'Album'});
 const file=join(root,'source.wav');await writeFile(file,'source test fixture');
 const asset=await api('asset_import',{project_id:'album',path:file,role:'source'});
 await api('mastering_add_song',{project_id:'album',base_revision:0,request_id:'song-one-v1',song_id:'one',name:'First',asset_id:asset.id});
 await api('mastering_add_song',{project_id:'album',base_revision:1,request_id:'song-two-v1',song_id:'two',name:'Second',asset_id:asset.id});
 const edit={project_id:'album',base_revision:2,request_id:'song-one-v2',song_id:'one',parent_version_id:'song-one-v1',label:'Quieter',input_gain_db:-6};
 await api('mastering_create_version',edit);
 assert.equal((await api('mastering_create_version',edit)).replayed,true);
 await api('project_apply',{project_id:'album',base_revision:3,request_id:'compare',operations:[{op:'set_comparison',song_id:'one',slot:'a',selection:{kind:'version',version_id:'song-one-v1'}},{op:'set_comparison',song_id:'one',slot:'b',selection:{kind:'version',version_id:'song-one-v2'}}]});
 const a=await service.compileGraph('album',{song_id:'one',comparison:'a'}),b=await service.compileGraph('album',{song_id:'one',comparison:'b'}),other=await service.compileGraph('album',{song_id:'two'});
 assert.equal(a.tracks.length,1);assert.equal(a.buses.length,0);
 assert.equal(a.tracks[0].gain_db,0);assert.equal(b.tracks[0].gain_db,-6);assert.equal(other.tracks[0].gain_db,0);
 assert.equal((await api('project_document',{project_id:'album'})).revision,4);
 const old=await api('project_document',{project_id:'album',revision:1});assert.equal(old.mastering.songs.length,1);
 await api('project_restore',{project_id:'album',base_revision:4,request_id:'restore-one',revision:1});
 assert.equal((await api('project_document',{project_id:'album'})).revision,5);
 assert.equal((await api('project_document',{project_id:'album',revision:4})).mastering.songs.length,2);
 await assert.rejects(api('project_apply',{project_id:'album',base_revision:5,request_id:'bad',operations:[{op:'set_bpm',bpm:80}]}),/mastering|composition/i);
});
test('composition is nested in the stored document and exceeds 64 tracks',async t=>{
 const {service,api}=await setup(t);
 await api('project_create',{project_id:'song',kind:'composition',name:'Song',instrument_policy:'allow_basic'});
 await api('project_apply',{project_id:'song',base_revision:0,request_id:'many',operations:Array.from({length:65},(_,i)=>({op:'add_track',track:{id:`t${i}`,name:`Track ${i}`,instrument:{kind:'builtin',sound:'sine'},notes:[]}}))});
 const doc=await api('project_document',{project_id:'song'});assert.equal(doc.kind,'composition');assert.equal(doc.composition.tracks.length,65);assert.equal(doc.tracks,undefined);
 assert.equal((await service.read('song')).tracks.length,65);
});
test('independent players on one storage root cannot process audio simultaneously',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-audio-lane-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const a=new ProcessingQueue(root),b=new ProcessingQueue(root);let active=0,max=0;
 const work=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,30));active--;};
 await Promise.all([a.run('first',work),b.run('second',work)]);assert.equal(max,1);assert.equal(active,0);
});
