import {copyFile, lstat, mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse, stringify} from 'smol-toml';

function normalized(path) {
  return normalize(resolve(path)).toLowerCase();
}

async function existingRegularFile(path) {
  try {
    const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink())throw Error(`Config must be a regular file: ${path}`);
    return {text:await readFile(path,'utf8'),mode:info.mode};
  } catch(error) {
    if(error?.code==='ENOENT')return {text:null,mode:0o600};
    throw error;
  }
}

async function atomicWrite(path,text,mode) {
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.aidaw-${process.pid}.tmp`;
  try {
    await writeFile(temporary,text,{mode,flag:'wx'});
    await rename(temporary,path);
  } finally {
    await unlink(temporary).catch(error=>{if(error?.code!=='ENOENT')throw error;});
  }
}

export async function configureCodexHttp({
  configPath,
  backupDir,
  url,
  expectedDataDir,
  serverName='aidaw',
  tokenEnv='AIDAW_HTTP_TOKEN',
}) {
  if(!configPath||!backupDir||!url||!expectedDataDir)throw Error('configPath, backupDir, url and expectedDataDir are required');
  if(!/^[A-Za-z0-9_-]+$/.test(serverName))throw Error(`Invalid MCP server name: ${serverName}`);
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv))throw Error(`Invalid token environment variable: ${tokenEnv}`);
  const parsedUrl=new URL(url);
  const loopback=['127.0.0.1','localhost','::1'].includes(parsedUrl.hostname);
  if(parsedUrl.protocol!=='https:'&&!(parsedUrl.protocol==='http:'&&loopback))throw Error('Remote MCP URL must use HTTPS; plain HTTP is allowed only for loopback');

  const current=await existingRegularFile(configPath);
  const data=current.text===null?{}:parse(current.text);
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error(`Invalid Codex config: ${configPath}`);
  data.mcp_servers??={};
  if(!data.mcp_servers||typeof data.mcp_servers!=='object'||Array.isArray(data.mcp_servers))throw Error(`Invalid mcp_servers table: ${configPath}`);

  const previous=data.mcp_servers[serverName];
  if(previous!==undefined&&(!previous||typeof previous!=='object'||Array.isArray(previous)))throw Error(`Invalid existing MCP server: ${serverName}`);
  if(previous?.command) {
    const previousHome=previous.env?.AIDAW_HOME;
    if(previousHome&&normalized(previousHome)!==normalized(expectedDataDir))throw Error(`Existing AIDAW_HOME differs in ${configPath}`);
  } else if(previous?.url&&previous.url!==url) {
    throw Error(`Existing ${serverName} URL differs in ${configPath}`);
  }

  data.mcp_servers[serverName]={
    url,
    bearer_token_env_var:tokenEnv,
    startup_timeout_sec:previous?.startup_timeout_sec??30,
    tool_timeout_sec:previous?.tool_timeout_sec??300,
  };
  const next=stringify(data);
  parse(next);
  if(current.text===next)return {path:configPath,changed:false,backup:null};

  await mkdir(backupDir,{recursive:true});
  let backup=null;
  if(current.text!==null) {
    backup=join(backupDir,'codex.before-http.toml');
    await copyFile(configPath,backup,0);
  }
  if((await existingRegularFile(configPath)).text!==current.text)throw Error(`Config changed during setup: ${configPath}`);
  await atomicWrite(configPath,next,current.mode);
  return {path:configPath,changed:true,backup};
}

function option(argv,name) {
  const index=argv.indexOf(name);
  if(index<0||!argv[index+1])throw Error(`Missing ${name}`);
  return argv[index+1];
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  const argv=process.argv.slice(2);
  const result=await configureCodexHttp({
    configPath:option(argv,'--config'),
    backupDir:option(argv,'--backup-dir'),
    url:option(argv,'--url'),
    expectedDataDir:option(argv,'--data-dir'),
    serverName:argv.includes('--name')?option(argv,'--name'):'aidaw',
    tokenEnv:argv.includes('--token-env')?option(argv,'--token-env'):'AIDAW_HTTP_TOKEN',
  });
  console.log(JSON.stringify(result));
}
