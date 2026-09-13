import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import {call} from '../../Application/api.js';
import {createMcpServer} from '../mcp/mcp-server.js';
import {ArtifactError,negotiateApplication,type ApplicationPort,type ArtifactPort} from '../../Contracts/application-contract.js';

class HttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
const digest=(s:string)=>createHash('sha256').update(s).digest();
const json=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const maxUpload=512*1024*1024;
export async function startHttpServer(options:{application:ApplicationPort;artifacts:ArtifactPort;host?:string;port?:number;token:string}){
 negotiateApplication(options.application);
 if(options.token.length<32)throw new Error('AIDAW_HTTP_TOKEN must contain at least 32 characters; use a random token');
 const application=options.application;const sessions=new Map<string,{mcp:ReturnType<typeof createMcpServer>;transport:StreamableHTTPServerTransport;last:number;busy:number}>();
 let closing=false,uploads=0,initializing=0;
 const listener=createServer((req,res)=>{void handle(req,res).catch(e=>{if(!res.headersSent)json(res,e instanceof HttpError || e instanceof ArtifactError?e.status:500,{error:e instanceof HttpError || e instanceof ArtifactError?e.message:'Server operation failed'});else res.destroy();});});
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
   if(Number(req.headers['content-length']??0)>maxUpload)throw new HttpError(413,'Upload limit is 512 MiB');
   uploads++;
   try{json(res,201,await options.artifacts.upload(String(req.headers['x-aidaw-filename']??'source.wav'),req,maxUpload));}finally{uploads--;}
   return;
  }
  if(url.pathname==='/files'&&req.method==='GET'){
   const identifier=url.searchParams.get('path');if(!identifier)throw new HttpError(400,'Provide a server artifact identifier');
   const file=await options.artifacts.download(identifier);
   res.writeHead(200,{'content-type':file.contentType,'content-length':file.bytes,'cache-control':'no-store','x-content-type-options':'nosniff'});
   await pipeline(file.body,res);return;
  }
  if(url.pathname==='/api'&&req.method==='POST'){
   let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw new HttpError(413,'API JSON exceeds 64 MiB');chunks.push(chunk);}
   let command:any;try{command=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON');}
   if(!command||typeof command.name!=='string')throw new HttpError(400,'Provide a command name and input');
   json(res,200,await call(application,command.name,command.input??{}));return;
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
    const mcp=createMcpServer(application);const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),onsessioninitialized:session=>{sessions.set(session,entry!);}});
    entry={mcp,transport,last:Date.now(),busy:0};await mcp.connect(transport);
   }catch(e){initializing--;throw e;}
  }
  const active=entry;active.last=Date.now();active.busy++;
  try{await active.transport.handleRequest(req,res,body);}finally{if(starting)initializing--;active.busy--;active.last=Date.now();if(req.method==='DELETE'||!active.transport.sessionId){if(id)sessions.delete(String(id));await active.mcp.close();}}
 }
 const sweep=setInterval(()=>{for(const[id,s]of sessions)if(!s.busy&&Date.now()-s.last>30*60*1000){sessions.delete(id);void s.mcp.close();}},60000);sweep.unref();
 try{await new Promise<void>((ok,fail)=>{listener.once('error',fail);listener.listen(options.port??8787,options.host??'127.0.0.1',()=>{listener.off('error',fail);ok();});});}catch(e){clearInterval(sweep);throw e;}
 const address=listener.address();if(!address||typeof address==='string')throw new Error('No HTTP address');
 return {server:listener,application,port:address.port,async close(){if(closing)return;closing=true;clearInterval(sweep);await Promise.allSettled([...sessions.values()].map(s=>s.mcp.close()));sessions.clear();try{await application.close();}finally{listener.closeAllConnections();await new Promise<void>((ok,fail)=>listener.close(e=>e?fail(e):ok()));}}};
}
