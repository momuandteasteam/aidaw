import { acquireServerLease } from './server-lease.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Service } from './service.js';
import { createMcpServer } from './mcp-server.js';
const service=new Service();
const release=await acquireServerLease(service.root);
const server=createMcpServer(service);
let closing = false;
async function close() { if (closing) return; closing = true; try{await service.close(); await server.close();}finally{await release();} }
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
process.stdin.on('end', () => { void close(); });
try{await server.connect(new StdioServerTransport());}catch(e){await close();throw e;}
