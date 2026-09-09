import {startHttpServer} from './http-server.js';
const port=Number(process.env.AIDAW_HTTP_PORT??8787);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid AIDAW_HTTP_PORT');
const host=process.env.AIDAW_HTTP_HOST??'127.0.0.1';
const server=await startHttpServer({token:process.env.AIDAW_HTTP_TOKEN??'',host,port});
console.log(`AIDAW Streamable HTTP listening at ${host}:${server.port}/mcp. Bearer authentication required.`);
process.on('SIGINT',()=>{void server.close();});process.on('SIGTERM',()=>{void server.close();});
