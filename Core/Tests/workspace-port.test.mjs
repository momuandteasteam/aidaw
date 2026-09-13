import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Service} from '../Build/JS/Application/service.js';

class MemoryWorkspace {
 documents=new Map();versions=new Map();receipts=new Map();tail=Promise.resolve();
 async create(document){if(this.documents.has(document.id))throw Error('Already exists');this.documents.set(document.id,structuredClone(document));this.versions.set(document.id,[structuredClone(document)]);}
 async read(id){if(!this.documents.has(id))throw Error('Unknown project');return structuredClone(this.documents.get(id));}
 async readRevision(id,revision){const p=this.versions.get(id)?.[revision];if(!p)throw Error('Unknown revision');return structuredClone(p);}
 async list(){return [...this.documents.values()].map(p=>({project_id:p.id,name:p.name,revision:p.revision,kind:p.kind??'composition'}));}
 async history(id,offset,limit){const docs=this.versions.get(id);return {head_revision:docs.at(-1).revision,total:docs.length,entries:docs.slice(offset,offset+limit).map(p=>({revision:p.revision}))};}
 async change(request,prepare){
  const run=this.tail.then(async()=>{
   const key=request.projectId+':'+request.requestId,prior=this.receipts.get(key);
   if(prior){if(prior.fingerprint!==request.fingerprint)throw Error('request_id reused with different content');return {...prior.result,replayed:true};}
   const current=await this.read(request.projectId);if(current.revision!==request.baseRevision)throw Error('Revision conflict');
   const next=await prepare(current,{});this.documents.set(next.id,structuredClone(next));this.versions.get(next.id).push(structuredClone(next));
   const result={project_id:next.id,revision:next.revision,replayed:false};this.receipts.set(key,{fingerprint:request.fingerprint,result});return result;
  });this.tail=run.catch(()=>{});return run;
 }
}
test('Service creates, edits, retries, lists and restores through an injected workspace without touching disk or engine',async()=>{
 const root=join(tmpdir(),'aidaw-no-files-'+randomUUID()),workspace=new MemoryWorkspace();
 const engine=new Proxy({},{get(_target,key){if(key==='close')return async()=>{};throw Error('Document edit must not invoke an engine');}});
 const service=new Service(root,engine,{workspace});
 await service.create({project_id:'song',name:'Song',bpm:120,length_ticks:3840,meter:[4,4],kind:'composition'});
 const edit={project_id:'song',base_revision:0,request_id:'tempo',operations:[{op:'set_bpm',bpm:96}]};
 assert.equal((await service.apply(edit)).revision,1);assert.equal((await service.apply(edit)).replayed,true);
 assert.equal((await service.read('song')).bpm,96);
 await assert.rejects(service.apply({...edit,request_id:'stale'}),/Revision conflict/);
 await assert.rejects(service.apply({...edit,operations:[{op:'set_bpm',bpm:80}]}),/reused/);
 const restored=await service.restore({project_id:'song',base_revision:1,request_id:'restore',revision:0});assert.equal(restored.revision,2);assert.equal((await service.read('song')).bpm,120);
 assert.equal((await service.compileGraph('song',{revision:1})).bpm,96);
 assert.equal((await service.listProjects())[0].project_id,'song');assert.equal((await service.history('song')).total,3);
 await service.close();await assert.rejects(access(root),{code:'ENOENT'});
});
