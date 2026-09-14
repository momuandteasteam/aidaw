import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {effectChain,chainSelection} from '../Contracts/effect-chain.js';
import {defaultWorkspaceRoot} from '../Adapters/node/workspace/home.js';
import {id} from '../Domain/schema.js';
import type {Service} from './service.js';
import {z} from 'zod';
type Selection=z.infer<ReturnType<typeof selectionSchema>>;
function selectionSchema(){return z.object(chainSelection).strict();}
export class EffectChains {
 constructor(readonly service:Service,readonly directory=join(defaultWorkspaceRoot(),'Workflows','Templates','EffectChains')){}
 async inspect(chainId:string,version?:string){id.parse(chainId);const path=join(this.directory,chainId+'.json'),stat=await lstat(path);if(!stat.isFile()||stat.size>256*1024)throw Error('Invalid chain file');const chain=effectChain.parse(JSON.parse(await readFile(path,'utf8')));if(chain.id!==chainId||version&&chain.version!==version)throw Error('Chain identity/version mismatch');return {chain,sha256:createHash('sha256').update(JSON.stringify(chain)).digest('hex')};}
 async list(){const result=[];for(const file of (await readdir(this.directory)).sort()){if(!file.endsWith('.json'))continue;const {chain}=await this.inspect(file.slice(0,-5));result.push({id:chain.id,name:chain.name,version:chain.version,stages:chain.stages.length});}return {chains:result};}
 async resolve(input:Selection){const a=selectionSchema().parse(input),{chain,sha256}=await this.inspect(a.chain_id,a.chain_version);for(const key of new Set([...Object.keys(a.enabled),...Object.keys(a.parameters)]))if(!chain.stages.some(s=>s.id===key))throw Error('Unknown chain stage: '+key);
  const catalog=await this.service.catalog(),effects=[];
  for(const stage of chain.stages){if(!(a.enabled[stage.id]??stage.enabled))continue;const matches=catalog.plugins.filter(p=>p.name===stage.plugin.name&&p.vendor===stage.plugin.vendor&&p.version===stage.plugin.version&&p.format===stage.plugin.format);if(matches.length!==1)throw Error('Install/scan exactly one matching plugin: '+stage.plugin.name+' '+stage.plugin.version);
   const spec={kind:'plugin' as const,plugin_id:matches[0].plugin_id,plugin_version:matches[0].version,parameters:[]},info=await this.service.inspectPlugin(spec);
   const overrides=a.parameters[stage.id]??[];if(new Set(overrides.map(p=>p.name)).size!==overrides.length)throw Error('Duplicate chain parameter override');const merged=new Map(stage.parameters.map(p=>[p.name,p]));for(const change of overrides)merged.set(change.name,change);
   const parameters=[...merged.values()].map(change=>{const found=info.parameters.filter((p:any)=>p.name===change.name);if(found.length!==1||!found[0].id)throw Error('Unknown or ambiguous parameter: '+change.name);return {id:found[0].id,value:change.value};});effects.push({...spec,parameters});
  }
  if(!effects.length)throw Error('Chain has no enabled effects');return {chain_id:chain.id,name:chain.name,chain_version:chain.version,sha256,effects};
 }
 async apply(a:any){const resolved=await this.resolve({chain_id:a.chain_id,chain_version:a.chain_version,enabled:a.enabled??{},parameters:a.parameters??{}}),summary=`${resolved.name} ${resolved.chain_version} [${resolved.sha256}]`;
  if(a.target.kind==='mastering')return this.service.createMasteringVersion({...a,song_id:a.target.song_id,parent_version_id:a.target.parent_version_id,label:resolved.name,summary,effects:resolved.effects});
  const document=await this.service.readDocument(a.project_id);if('kind' in document&&document.kind!=='composition')throw Error('Master target requires a composition project');
  return this.service.apply({...a,summary,operations:[{op:'set_master_effects',effects:resolved.effects}]});
 }
}
