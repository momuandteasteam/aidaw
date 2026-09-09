import test from 'node:test';
import assert from 'node:assert/strict';
import {ProcessingQueue} from '../dist/processing-queue.js';
import {fixture,seed} from './helpers.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('single lane is FIFO and nested processing does not deadlock',async()=>{
 const queue=new ProcessingQueue(),gate=deferred(),events=[];let active=0,maximum=0;
 const work=n=>queue.run('job',async()=>{maximum=Math.max(maximum,++active);events.push(n);if(n===1)await gate.promise;await queue.run('nested',async()=>events.push('nested'+n));active--;});
 const first=work(1),second=work(2),third=work(3);assert.equal(queue.status().queued.length,2);gate.resolve();await Promise.all([first,second,third]);assert.equal(maximum,1);assert.deepEqual(events,[1,'nested1',2,'nested2',3,'nested3']);
});
test('queued cancellation never executes its work and a failed job releases the lane',async()=>{
 const q=new ProcessingQueue(),gate=deferred(),cancel=new AbortController();const first=q.run('hold',()=>gate.promise);let ran=false;
 const next=q.run('cancel',async()=>{ran=true;},{signal:cancel.signal});const rejected=assert.rejects(next,/cancelled/);cancel.abort();await rejected;gate.resolve();await first;
 await assert.rejects(q.run('fails',async()=>{throw Error('failure');}),/failure/);assert.equal(await q.run('after',async()=>42),42);assert.equal(ran,false);
});
test('render, batch and inspection share one lane while published delivery remains readable',async t=>{
 const {api,service}=await fixture(t);await seed(api);const complete=await service.wait((await api('render_start',{project_id:'song',tail_seconds:0})).job_id);
 await api('delivery_publish',{project_id:'song',job_id:complete.id,tags:{title:'Completed'},mp3:false});
 const asset=await api('asset_import',{project_id:'song',path:complete.output,role:'source'});const gate=deferred();const occupied=service.processing.run('held audio operation',()=>gate.promise);t.after(()=>gate.resolve());
 const first=await api('render_start',{project_id:'song',tail_seconds:0});const batch=await api('batch_render',{project_id:'song',tasks:[{id:'batch',name:'Batch',clip:{kind:'audio',asset_id:asset.id},tail_seconds:0}]});
 let inspected=false;const inspect=api('audio_analyze',{path:complete.output}).then(()=>{inspected=true;});
 assert.equal((await api('job_status',{job_id:first.job_id})).state,'queued');assert.equal((await api('job_status',{job_id:batch.job_id})).state,'queued');
 assert.equal((await api('delivery_inspect',{project_id:'song'})).available,true);assert.equal((await api('project_list')).length,1);assert.equal(inspected,false);
 await api('job_cancel',{job_id:first.job_id});assert.equal((await api('job_status',{job_id:first.job_id})).state,'cancelled');gate.resolve();await occupied;await inspect;assert.equal((await service.wait(batch.job_id)).state,'succeeded');
});

test('server data directory has one owner and can reopen after clean shutdown',async t=>{
 const {root}=await fixture(t);const {acquireServerLease}=await import('../dist/server-lease.js');const release=await acquireServerLease(root);
 await assert.rejects(acquireServerLease(root),/already owns/);await release();const next=await acquireServerLease(root);await next();
});
