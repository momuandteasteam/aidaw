import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectArtwork} from '../Build/JS/Adapters/node/media/artwork.js';
import {createControlRuntime} from '../Source/Desktop/runtime/control-runtime.mjs';
test('collected artwork handles missing, latest, corruption and project containment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aidaw-artwork-'));const service={dir:()=>dir,async readDocument(){return {};}};
 try{
  assert.equal((await projectArtwork(service,'song')).data_url,null);
  await mkdir(join(dir,'assets/artwork'),{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const hash=createHash('sha256').update(png).digest('hex'),path=`assets/artwork/${hash}.png`,asset={id:hash+'-artwork',sha256:hash,path,role:'artwork',name:'cover.png',parents:[]};
  await writeFile(join(dir,path),png);const save=assets=>writeFile(join(dir,'manifest.json'),JSON.stringify({schema_version:1,assets}));
  await save([asset]);assert.equal((await projectArtwork(service,'song')).data_url,'data:image/png;base64,'+png.toString('base64'));
  await save([asset,{...asset,path:'../outside.png'}]);assert.equal((await projectArtwork(service,'song')).data_url,null);
  await save([asset]);await writeFile(join(dir,path),'broken');assert.equal((await projectArtwork(service,'song')).data_url,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('artwork selection clears immediately and discards a late previous project response',async()=>{
 const pending={};const runtime=createControlRuntime({application:{invoke(name,args){return new Promise(resolve=>{pending[args.project_id]=resolve;});}},host:{}});
 const doc=id=>({id,kind:'composition',revision:1,composition:{bpm:120,tracks:[]}});
 try{
  runtime.patch({api:['project_artwork'],projectId:'a',document:doc('a')});
  runtime.patch({projectId:'b',document:doc('b')});
  pending.b({data_url:'data:image/png;base64,new'});await nextTurn();assert.equal(runtime.snapshot().artworkUrl,'data:image/png;base64,new');
  pending.a({data_url:'data:image/png;base64,old'});await nextTurn();assert.equal(runtime.snapshot().artworkUrl,'data:image/png;base64,new');
  runtime.patch({document:null});assert.equal(runtime.snapshot().artworkUrl,null);
 }finally{runtime.dispose();}
});
