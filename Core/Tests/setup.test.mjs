import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {parse} from 'smol-toml';
import {planConfigs,applyConfigs} from '../Tools/setup/config.mjs';
import {uvPythonEnvironment} from '../Tools/setup/python-environment.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidaw setup 日本語 '));t.after(()=>rm(root,{recursive:true,force:true}));return {root,client:'both',node:process.execPath,env:{AIDAW_HOME:join(root,'data'),AIDAW_ENGINE:join(root,'engine'),AIDAW_FFMPEG:'/path with space/ffmpeg',AIDAW_FFPROBE:'/path/ffprobe'}};}
test('setup merges both configurations, backs up exact originals and is idempotent',async t=>{
 const options=await fixture(t);await mkdir(join(options.root,'.codex'));const toml='# original comment\nmodel = "preserve-me"\n[mcp_servers.other]\ncommand="other"\n';const json=JSON.stringify({mcpServers:{other:{command:'other'}},custom:'keep'});
 await writeFile(join(options.root,'.codex/config.toml'),toml);await writeFile(join(options.root,'.mcp.json'),json);
 const result=await applyConfigs(await planConfigs(options),join(options.root,'backup'));assert.equal(await readFile(result[0].backup,'utf8'),toml);
 const codex=parse(await readFile(result[0].path,'utf8'));assert.equal(codex.model,'preserve-me');assert.equal(codex.mcp_servers.other.command,'other');assert.deepEqual(codex.mcp_servers.aidaw.env,options.env);
 const claude=JSON.parse(await readFile(result[1].path,'utf8'));assert.equal(claude.custom,'keep');assert.equal(claude.mcpServers.other.command,'other');assert.deepEqual(claude.mcpServers.aidaw.args,[join(options.root,'Core/Build/JS/Server/mcp.js')]);assert.ok((await planConfigs(options)).every(p=>!p.changed));
});
test('malformed or conflicting config does not overwrite either client',async t=>{
 const options=await fixture(t);await writeFile(join(options.root,'.mcp.json'),'{bad');await assert.rejects(planConfigs(options));await assert.rejects(readFile(join(options.root,'.codex/config.toml')),/ENOENT/);
 await writeFile(join(options.root,'.mcp.json'),JSON.stringify({mcpServers:{aidaw:{env:{AIDAW_HOME:'/old-data'}}}}));await assert.rejects(planConfigs(options),/AIDAW_HOME differs/);
});
test('concurrent edits are detected and Windows paths round-trip',async t=>{
 const options=await fixture(t);options.env.AIDAW_HOME='C:\\Users\\Name With Space\\音源';const plans=await planConfigs(options);assert.equal(parse(plans[0].next).mcp_servers.aidaw.env.AIDAW_HOME,options.env.AIDAW_HOME);
 await writeFile(join(options.root,'.mcp.json'),'{}');await assert.rejects(applyConfigs(plans,join(options.root,'backup')),/changed during setup/);await assert.rejects(readFile(join(options.root,'.codex/config.toml')),/ENOENT/);
});

test('explicit new-home setup changes the target with an exact configuration backup',async t=>{
 const options=await fixture(t),previous=JSON.stringify({mcpServers:{aidaw:{env:{AIDAW_HOME:'/feasibility'}}}});
 await writeFile(join(options.root,'.mcp.json'),previous);
 const results=await applyConfigs(await planConfigs({...options,newHome:true}),join(options.root,'backup'));
 const claude=results.find(r=>r.path.endsWith('.mcp.json'));
 assert.equal(await readFile(claude.backup,'utf8'),previous);
 assert.equal(JSON.parse(await readFile(claude.path,'utf8')).mcpServers.aidaw.env.AIDAW_HOME,options.env.AIDAW_HOME);
});

test('Antigravity merges sparse workspace MCP config and generates a bounded common entry',async t=>{
 const options={...await fixture(t),client:'antigravity'};await mkdir(join(options.root,'.agents'));
 const path=join(options.root,'.agents','mcp_config.json');await writeFile(path,JSON.stringify({mcpServers:{other:{command:'existing'},aidaw:{disabledTools:['example'],env:{CUSTOM:'keep'}}},custom:'keep'}));
 const plans=await planConfigs(options);assert.equal(plans.length,2);await applyConfigs(plans,join(options.root,'backup'));
 const config=JSON.parse(await readFile(path,'utf8'));assert.equal(config.custom,'keep');assert.equal(config.mcpServers.other.command,'existing');const aidaw=config.mcpServers.aidaw;assert.equal(aidaw.env.CUSTOM,'keep');assert.equal(aidaw.env.AIDAW_HOME,options.env.AIDAW_HOME);assert.equal(aidaw.type,undefined);assert.equal(aidaw.startup_timeout_sec,undefined);assert.deepEqual(aidaw.disabledTools,['example']);
 const rule=await readFile(join(options.root,'.agents/rules/aidaw.md'),'utf8');assert.match(rule,/AGENTS.md/);assert.ok(rule.length<500);assert.ok((await planConfigs(options)).every(p=>!p.changed));
 assert.equal((await planConfigs({...options,client:'both'})).length,2);assert.equal((await planConfigs({...options,client:'all'})).length,4);
});
test('Antigravity rejects remote replacement and unmanaged rule collisions',async t=>{
 const options={...await fixture(t),client:'antigravity'};await mkdir(join(options.root,'.agents/rules'),{recursive:true});const path=join(options.root,'.agents/mcp_config.json');
 await writeFile(path,JSON.stringify({mcpServers:{aidaw:{serverUrl:'https://example.com/mcp'}}}));await assert.rejects(planConfigs(options),/not a local server/);
 await writeFile(path,'{}');await writeFile(join(options.root,'.agents/rules/aidaw.md'),'Personal rule');await assert.rejects(planConfigs(options),/not managed/);assert.equal(await readFile(path,'utf8'),'{}');
});
test('separation Python is isolated per workspace unless explicitly configured',()=>{
 const workspace=join('C:','AIDAW 日本語'),inherited={PATH:'tools'};
 const defaultEnv=uvPythonEnvironment(workspace,inherited);
 assert.equal(defaultEnv.UV_PYTHON_INSTALL_DIR,join(resolve(workspace),'Plugins/Engines/python'));assert.equal(inherited.UV_PYTHON_INSTALL_DIR,undefined);
 const explicit=join('D:','shared uv python');assert.equal(uvPythonEnvironment(workspace,{...inherited,UV_PYTHON_INSTALL_DIR:explicit}).UV_PYTHON_INSTALL_DIR,explicit);
});
