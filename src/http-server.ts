import { acquireServerLease } from './server-lease.js';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rm,stat} from 'node:fs/promises';
import {join,extname,relative,isAbsolute} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import {createMcpServer} from './mcp-server.js';
import {Service} from './service.js';
import {contained,sha256} from './assets.js';
import {layout,newJob} from './layout.js';
import {atomicJson} from './storage.js';

class HttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
const digest=(s:string)=>createHash('sha256').update(s).digest();
const json=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const maxUpload=512*1024*1024;
export async function startHttpServer(options:{service?:Service;host?:string;port?:number;token:string}){
 if(options.token.length<32)throw new Error('AIDAW_HTTP_TOKEN must contain at least 32 characters; use a random token');
 const service=options.service??new Service();const sessions=new Map<string,{mcp:ReturnType<typeof createMcpServer>;transport:StreamableHTTPServerTransport;last:number;busy:number}>();
 const release=await acquireServerLease(service.root);
 let closing=false,uploads=0,initializing=0;
 const listener=createServer((req,res)=>{void handle(req,res).catch(e=>{if(!res.headersSent)json(res,e instanceof HttpError?e.status:500,{error:e instanceof HttpError?e.message:'Server operation failed'});else res.destroy();});});
 listener.requestTimeout=15*60*1000;listener.headersTimeout=30000;
 async function handle(req:IncomingMessage,res:ServerResponse){
  if(closing)throw new HttpError(503,'Server shutting down');
  if(!timingSafeEqual(digest(req.headers.authorization??''),digest('Bearer '+options.token)))throw new HttpError(401,'Bearer token required');
  // Native clients / reverse proxies only. Do not expose an authenticated local
  // service to browser origins through permissive CORS or implicit cookies.
  if(req.headers.origin)throw new HttpError(403,'Browser Origin is not enabled');
  const url=new URL(req.url??'/','http://localhost');
  if(url.pathname==='/health'&&req.method==='GET'){json(res,200,{status:'ok',transport:'streamable-http',sessions:sessions.size});return;}
  if(url.pathname==='/uploads'&&req.method==='POST'){
   if(uploads>=4)throw new HttpError(429,'Too many uploads');
   const suffix=extname(String(req.headers['x-aidaw-filename']??'source.wav')).toLowerCase();
   if(!['.wav','.mid','.midi','.zip','.jpg','.jpeg','.png','.nksf','.mb2'].includes(suffix))throw new HttpError(400,'Unsupported upload extension');
   if(Number(req.headers['content-length']??0)>maxUpload)throw new HttpError(413,'Upload limit is 512 MiB');
   uploads++;let file:string|undefined,job:any;
   try{
    const dir=join(service.root,'Inbox.aidaw');await layout(dir);job=await newJob(dir,{kind:'remote_upload',filename:String(req.headers['x-aidaw-filename']??'source.wav')});
    file=join(job.path,'artifacts',randomUUID()+suffix);await mkdir(join(job.path,'artifacts'),{recursive:true});let bytes=0;
    const limit=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>maxUpload?new HttpError(413,'Upload limit is 512 MiB'):null,chunk);}});
    await pipeline(req,limit,createWriteStream(file,{flags:'wx',mode:0o600}));if(!bytes)throw new HttpError(400,'Empty upload');
    const hash=await sha256(file);const result={job_id:job.id,path:file,bytes,sha256:hash,next:'Use this SERVER path with asset_import (audio/artwork), midi_import or bundle_import. Upload alone does not validate its format.'};await atomicJson(join(job.path,'status.json'),{state:'succeeded',...result});json(res,201,result);
   }catch(e){if(file)await rm(file,{force:true});if(job)await atomicJson(join(job.path,'status.json'),{state:'failed',error:String(e)});throw e;}finally{uploads--;}
   return;
  }
  if(url.pathname==='/files'&&req.method==='GET'){
   const requested=url.searchParams.get('path');if(!requested||!isAbsolute(requested))throw new HttpError(400,'Provide an absolute server output path');
   const rel=relative(service.root,requested).split('\\').join('/');let path:string;
   try{path=await contained(service.root,rel);}catch{throw new HttpError(403,'File is outside AIDAW storage');}
   if(!/(?:^|\/)(?:outputs|artifacts|assets)\/|\/state\/frozen\//.test(rel)||!['.wav','.mp3','.mid','.midi','.zip','.json','.png','.jpg','.jpeg'].includes(extname(path).toLowerCase()))throw new HttpError(403,'Only assets and generated artifacts can be downloaded');
   const info=await stat(path);if(!info.isFile())throw new HttpError(404,'Not a file');
   const mime:Record<string,string>={'.wav':'audio/wav','.mp3':'audio/mpeg','.mid':'audio/midi','.json':'application/json','.zip':'application/zip','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
   res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','content-length':info.size,'cache-control':'no-store','x-content-type-options':'nosniff'});await pipeline(createReadStream(path),res);return;
  }
  if(url.pathname!=='/mcp')throw new HttpError(404,'Unknown endpoint');
  if(!['POST','GET','DELETE'].includes(req.method??''))throw new HttpError(405,'Method not allowed');
  let body:any;
  if(req.method==='POST'){
   let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw new HttpError(413,'MCP JSON exceeds 64 MiB');chunks.push(chunk);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON');}
  }
  const id=req.headers['mcp-session-id'];let starting=false;let entry=typeof id==='string'?sessions.get(id):undefined;
  if(id&&!entry)throw new HttpError(404,'Unknown MCP session; reconnect');
  if(!entry){
   if(req.method!=='POST'||!isInitializeRequest(body))throw new HttpError(400,'Initialize MCP first');
   if(sessions.size+initializing>=64)throw new HttpError(429,'Too many MCP sessions');initializing++;starting=true;
   try{
    const mcp=createMcpServer(service);const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),onsessioninitialized:session=>{sessions.set(session,entry!);}});
    entry={mcp,transport,last:Date.now(),busy:0};await mcp.connect(transport);
   }catch(e){initializing--;throw e;}
  }
  const active=entry;active.last=Date.now();active.busy++;
  try{await active.transport.handleRequest(req,res,body);}finally{if(starting)initializing--;active.busy--;active.last=Date.now();if(req.method==='DELETE'||!active.transport.sessionId){if(id)sessions.delete(String(id));await active.mcp.close();}}
 }
 const sweep=setInterval(()=>{for(const[id,s]of sessions)if(!s.busy&&Date.now()-s.last>30*60*1000){sessions.delete(id);void s.mcp.close();}},60000);sweep.unref();
 try{await new Promise<void>((ok,fail)=>{listener.once('error',fail);listener.listen(options.port??8787,options.host??'127.0.0.1',()=>{listener.off('error',fail);ok();});});}catch(e){clearInterval(sweep);await release();throw e;}
 const address=listener.address();if(!address||typeof address==='string')throw new Error('No HTTP address');
 return {server:listener,service,port:address.port,async close(){if(closing)return;closing=true;clearInterval(sweep);await Promise.allSettled([...sessions.values()].map(s=>s.mcp.close()));sessions.clear();await service.close();listener.closeAllConnections();await new Promise<void>((ok,fail)=>listener.close(e=>e?fail(e):ok()));await release();}};
}
