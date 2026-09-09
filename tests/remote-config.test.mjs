import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parse, stringify} from 'smol-toml';
import {configureCodexHttp} from '../scripts/setup/remote-config.mjs';

test('remote config converts a matching local AIDAW server and preserves unrelated settings',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-remote-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'.codex','config.toml'),backup=join(root,'backups'),dataDir=join(root,'data');await mkdir(join(root,'.codex'),{recursive:true});
 const original=stringify({model:'example',mcp_servers:{other:{url:'https://example.invalid/mcp'},aidaw:{command:'node',args:['dist/mcp.js'],env:{AIDAW_HOME:dataDir},tool_timeout_sec:450}}});
 await writeFile(config,original);
 const result=await configureCodexHttp({configPath:config,backupDir:backup,url:'http://127.0.0.1:8787/mcp',expectedDataDir:dataDir});
 assert.equal(result.changed,true);assert.equal(await readFile(result.backup,'utf8'),original);
 const next=parse(await readFile(config,'utf8'));assert.equal(next.model,'example');assert.equal(next.mcp_servers.other.url,'https://example.invalid/mcp');
 assert.deepEqual(next.mcp_servers.aidaw,{url:'http://127.0.0.1:8787/mcp',bearer_token_env_var:'AIDAW_HTTP_TOKEN',startup_timeout_sec:30,tool_timeout_sec:450});
});

test('remote config refuses mismatched data roots, changed URLs and insecure remote HTTP',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-remote-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config.toml'),backup=join(root,'backups');
 await writeFile(config,stringify({mcp_servers:{aidaw:{command:'node',env:{AIDAW_HOME:join(root,'one')}}}}));
 await assert.rejects(()=>configureCodexHttp({configPath:config,backupDir:backup,url:'http://127.0.0.1:8787/mcp',expectedDataDir:join(root,'two')}),/AIDAW_HOME differs/);
 await writeFile(config,stringify({mcp_servers:{aidaw:{url:'https://one.example/mcp'}}}));
 await assert.rejects(()=>configureCodexHttp({configPath:config,backupDir:backup,url:'https://two.example/mcp',expectedDataDir:root}),/URL differs/);
 await assert.rejects(()=>configureCodexHttp({configPath:join(root,'new.toml'),backupDir:backup,url:'http://192.0.2.5:8787/mcp',expectedDataDir:root}),/must use HTTPS/);
});

test('remote config command line writes a new Codex config without exposing a token',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-remote-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'.codex','config.toml'),backup=join(root,'backups');
 const run=spawnSync(process.execPath,['scripts/setup/remote-config.mjs','--config',config,'--backup-dir',backup,'--url','http://localhost:8787/mcp','--data-dir',join(root,'data')],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{path:config,changed:true,backup:null});
 const next=parse(await readFile(config,'utf8'));assert.equal(next.mcp_servers.aidaw.url,'http://localhost:8787/mcp');assert.equal(next.mcp_servers.aidaw.bearer_token_env_var,'AIDAW_HTTP_TOKEN');
 assert.doesNotMatch(await readFile(config,'utf8'),/[A-Fa-f0-9]{64}/);
});

test('Windows remote setup emits executable runner variable assignments',async()=>{
 const script=await readFile('scripts/setup-remote-windows.ps1','utf8');
 for(const name of ['NodePath','EnvironmentFile','EntryPoint','LogFile']){
  assert.match(script,new RegExp(`\\('\\$${name} = `));
  assert.doesNotMatch(script,new RegExp(`\\('`+'`'+`\\$${name} = `));
 }
});
