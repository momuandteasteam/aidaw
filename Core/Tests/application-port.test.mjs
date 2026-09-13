import { applicationContract,negotiateApplication } from '../Build/JS/Contracts/application-contract.js';
import { createMcpServer } from '../Build/JS/Adapters/mcp/mcp-server.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { call } from '../Build/JS/Application/api.js';
import { startHttpServer } from '../Build/JS/Adapters/http/http-server.js';

function fakeApplication(){
 let selection=null,closed=0;const calls=[];
 return {protocolVersion:1,contract:applicationContract,definitions:{
  active_context_get:{description:'Read selection',schema:z.object({}).strict()},
  active_context_set:{description:'Set selection',schema:z.object({project_id:z.string().nullable()}).strict()}
 },calls,get closed(){return closed;},async invoke(name,args){calls.push({name,args});if(name==='active_context_set')selection=args.project_id;return {project_id:selection};},async close(){closed++;}};
}
test('API validates an injected application without Service, engine, filesystem or native runtime',async()=>{
 const application=fakeApplication();await call(application,'active_context_set',{project_id:'song'});
 assert.equal((await call(application,'active_context_get',{})).project_id,'song');
 await assert.rejects(call(application,'missing',{}),/Unknown tool/);await assert.rejects(call(application,'active_context_set',{project_id:42}));
 assert.equal(application.calls.length,2);await assert.rejects(call({...application,protocolVersion:2},'active_context_get',{}),/Unsupported/);
});
test('plain HTTP and MCP share an independent application and injected artifact streams',async t=>{
 const application=fakeApplication(),token='a'.repeat(64),uploaded=[];
 const artifacts={async upload(filename,body,max){let value='';for await(const bytes of body)value+=Buffer.from(bytes).toString();uploaded.push({filename,value,max});return {id:'memory:upload',bytes:value.length};},async download(id){assert.equal(id,'memory:audio');return {bytes:3,contentType:'audio/wav',body:(async function*(){yield Buffer.from('wav');})()};}};
 const server=await startHttpServer({application,artifacts,token,port:0}),base=`http://127.0.0.1:${server.port}`,headers={Authorization:'Bearer '+token};
 t.after(()=>server.close());const client=new Client({name:'port-test',version:'1'});t.after(()=>client.close());
 const selected=await fetch(base+'/api',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({name:'active_context_set',input:{project_id:'album'}})});
 assert.equal(selected.status,200);assert.equal((await selected.json()).project_id,'album');
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers}}));
 assert.deepEqual((await client.listTools()).tools.map(x=>x.name).sort(),['active_context_get','active_context_set']);
 const context=await client.callTool({name:'active_context_get',arguments:{}});assert.equal(JSON.parse(context.content[0].text).project_id,'album');
 assert.equal((await fetch(base+'/api',{method:'POST',body:'{}'})).status,401);
 const upload=await fetch(base+'/uploads',{method:'POST',headers:{...headers,'x-aidaw-filename':'take.wav'},body:'abc'});assert.equal(upload.status,201);assert.equal(uploaded[0].value,'abc');
 const file=await fetch(base+'/files?path=memory%3Aaudio',{headers});assert.equal(file.status,200);assert.equal(await file.text(),'wav');
 await client.close();await server.close();assert.equal(application.closed,1);
});

test('application negotiation rejects unknown major, missing features and insufficient minor before transport starts',async()=>{
 const app=fakeApplication();assert.equal(negotiateApplication(app).version.major,1);
 const unknown={...app,contract:{...applicationContract,version:{major:2,minor:0}}};
 assert.throws(()=>createMcpServer(unknown),/major/);
 await assert.rejects(startHttpServer({application:unknown,artifacts:{},token:'a'.repeat(64),port:0}),/major/);
 assert.throws(()=>negotiateApplication(app,{major:1,minimumMinor:1,features:[]}),/minor/);
 assert.throws(()=>negotiateApplication(app,{major:1,minimumMinor:0,features:['future.v2']}),/feature unavailable/);
 assert.equal(negotiateApplication({...app,contract:{...applicationContract,version:{major:1,minor:3}}}).version.minor,3);
 await assert.rejects(call({...app,async invoke(){return {value:Infinity};}},'active_context_get',{}),/non-finite/);
});
