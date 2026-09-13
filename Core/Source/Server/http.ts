import { Service } from '../Application/service.js';
import { createLocalApplication } from '../Application/local-application.js';
import { createLocalArtifacts } from '../Adapters/node/workspace/local-artifacts.js';
import { acquireServerLease } from '../Adapters/node/runtime/server-lease.js';
import {startHttpServer} from '../Adapters/http/http-server.js';
const port=Number(process.env.AIDAW_HTTP_PORT??8787);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid AIDAW_HTTP_PORT');
const host=process.env.AIDAW_HTTP_HOST??'127.0.0.1';
const service=new Service(),release=await acquireServerLease(service.root);
let server;try{server=await startHttpServer({application:createLocalApplication(service),artifacts:createLocalArtifacts(service.root),token:process.env.AIDAW_HTTP_TOKEN??'',host,port});}catch(error){await service.close();await release();throw error;}
const close=server.close.bind(server);server.close=async()=>{try{await close();}finally{await release();}};
console.log(`AIDAW Streamable HTTP listening at ${host}:${server.port}/mcp. Bearer authentication required.`);
process.on('SIGINT',()=>{void server.close();});process.on('SIGTERM',()=>{void server.close();});
