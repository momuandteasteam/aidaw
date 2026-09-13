import { negotiateApplication,type ApplicationPort } from '../Contracts/application-contract.js';
/** Same command boundary for direct API, desktop, MCP and HTTP clients. */
export async function call(application:ApplicationPort,name:string,input:unknown):Promise<any> {
 negotiateApplication(application);
 if(!Object.hasOwn(application.definitions,name))throw new Error(`Unknown tool: ${name}`);
 const parsed=application.definitions[name].schema.parse(input);
 const result=await application.invoke(name,parsed);
 const encoded=JSON.stringify(result,(_key,value)=>{
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Application returned a non-finite JSON number');
  if(['bigint','function','symbol'].includes(typeof value))throw new Error('Application returned a non-JSON value');
  return value;
 });
 if(encoded===undefined)throw new Error('Application returned no JSON result');
 return JSON.parse(encoded);
}
