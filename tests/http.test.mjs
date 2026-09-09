import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startHttpServer} from '../dist/http-server.js';
import {Service} from '../dist/service.js';
import {track} from './helpers.mjs';
test('remote clients share server projects; uploads, rendering, downloads and auth work',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-http-'));const token=randomBytes(32).toString('hex');const service=new Service(root);const http=await startHttpServer({service,token,port:0});const base=`http://127.0.0.1:${http.port}`;const headers={Authorization:'Bearer '+token};const clients=[];
 t.after(async()=>{await Promise.allSettled(clients.map(c=>c.close()));await http.close();await rm(root,{recursive:true,force:true});});
 assert.equal((await fetch(base+'/health')).status,401);assert.equal((await fetch(base+'/health',{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
 async function connect(){const client=new Client({name:'remote-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers}}));clients.push(client);return client;}
 const a=await connect(),b=await connect();
 async function api(client,name,args={}){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);}
 await api(a,'project_create',{project_id:'remote',name:'Remote',length_ticks:3840,instrument_policy:'allow_basic'});
 assert.equal((await api(b,'project_inspect',{project_id:'remote'})).name,'Remote');
 await api(a,'project_apply',{project_id:'remote',base_revision:0,request_id:'notes',operations:[{op:'add_track',track}]});
 const job=await api(a,'render_start',{project_id:'remote',tail_seconds:0});await a.close();
 const completed=await service.wait(job.job_id);assert.equal(completed.state,'succeeded',completed.error);
 const status=await api(b,'job_status',{job_id:job.job_id});assert.equal(status.state,'succeeded');
 let release;const held=service.processing.run('long audio processing',()=>new Promise(resolve=>{release=resolve;}));t.after(()=>release?.());
 const result=await fetch(base+'/files?path='+encodeURIComponent(status.output),{headers});assert.equal(result.status,200);const bytes=Buffer.from(await result.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),status.sha256);
 release();await held;
 const upload=await fetch(base+'/uploads',{method:'POST',headers:{...headers,'x-aidaw-filename':'audio.wav'},body:bytes});assert.equal(upload.status,201);const source=await upload.json();assert.equal(source.sha256,status.sha256);
 const asset=await api(b,'asset_import',{project_id:'remote',path:source.path,role:'source'});assert.equal(asset.sha256,status.sha256);
 assert.equal((await fetch(base+'/files?path='+encodeURIComponent(join(root,'../outside.wav')),{headers})).status,403);
 await mkdir(join(root,'state'),{recursive:true});await writeFile(join(root,'state','secret.json'),'{}');assert.equal((await fetch(base+'/files?path='+encodeURIComponent(join(root,'state','secret.json')),{headers})).status,403);
 assert.equal((await fetch(base+'/uploads',{method:'POST',headers:{...headers,'x-aidaw-filename':'bad.exe'},body:'x'})).status,400);
 const empty=await fetch(base+'/uploads',{method:'POST',headers,body:''});assert.equal(empty.status,400);
});
