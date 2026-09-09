import {readFile,writeFile,mkdir,rename,lstat,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {parse,stringify} from 'smol-toml';

async function existing(path){
 try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error(`Config must be a regular file: ${path}`);return {text:await readFile(path,'utf8'),mode:stat.mode};}
 catch(e){if(e.code==='ENOENT')return {text:null,mode:0o600};throw e;}
}
export async function planConfigs({root,client,node,env}){
 const plans=[];
 for(const kind of ['codex','claude']){
  if(client!=='both'&&client!==kind)continue;
  const path=kind==='codex'?join(root,'.codex','config.toml'):join(root,'.mcp.json');
  const old=await existing(path);const data=old.text===null?{}:kind==='codex'?parse(old.text):JSON.parse(old.text);
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error(`Invalid config object: ${path}`);
  const key=kind==='codex'?'mcp_servers':'mcpServers';
  if(data[key]!==undefined&&(!data[key]||typeof data[key]!=='object'||Array.isArray(data[key])))throw Error(`Invalid MCP map: ${path}`);
  data[key]??={};const previous=data[key].aidaw??{};
  if(!previous||typeof previous!=='object'||Array.isArray(previous)||previous.url)throw Error(`Existing aidaw is not a local server: ${path}`);
  // Preserve user data locations and unrelated server options. Reject ambiguity instead of splitting projects.
  if(previous.env?.AIDAW_HOME&&previous.env.AIDAW_HOME!==env.AIDAW_HOME)throw Error(`Existing AIDAW_HOME differs in ${path}; rerun with --data-dir matching that path.`);
  data[key].aidaw={...previous,command:node,args:[join(root,'dist','mcp.js')],env:{...previous.env,...env},...(kind==='claude'?{type:'stdio'}:{startup_timeout_sec:previous.startup_timeout_sec??30,tool_timeout_sec:previous.tool_timeout_sec??300})};
  const next=kind==='codex'?stringify(data):JSON.stringify(data,null,2)+'\n';
  // Parse serialized settings before touching either client's file.
  kind==='codex'?parse(next):JSON.parse(next);
  plans.push({path,...old,next,kind,changed:old.text!==next});
 }
 return plans;
}
async function atomic(path,text,mode){await mkdir(dirname(path),{recursive:true});const tmp=path+`.aidaw-${process.pid}.tmp`;try{await writeFile(tmp,text,{mode,flag:'wx'});await rename(tmp,path);}finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
export async function applyConfigs(plans,backupDir){
 const changed=plans.filter(p=>p.changed),written=[];await mkdir(backupDir,{recursive:true});
 // Optimistic check avoids overwriting an edit made since planning.
 for(const p of changed){if((await existing(p.path)).text!==p.text)throw Error(`Config changed during setup: ${p.path}`);if(p.text!==null)await writeFile(join(backupDir,`${p.kind}.before`),p.text,{mode:0o600,flag:'wx'});}
 try{for(const p of changed){await atomic(p.path,p.next,p.mode);written.push(p);}}
 catch(e){for(const p of written.reverse()){if(p.text===null)await unlink(p.path);else await atomic(p.path,p.text,p.mode);}throw e;}
 return plans.map(p=>({path:p.path,changed:p.changed,backup:p.changed&&p.text!==null?join(backupDir,`${p.kind}.before`):null}));
}
