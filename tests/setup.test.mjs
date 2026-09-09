import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parse} from 'smol-toml';
import {planConfigs,applyConfigs} from '../scripts/setup/config.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidaw setup 日本語 '));t.after(()=>rm(root,{recursive:true,force:true}));return {root,client:'both',node:process.execPath,env:{AIDAW_HOME:join(root,'data'),AIDAW_ENGINE:join(root,'engine'),AIDAW_FFMPEG:'/path with space/ffmpeg',AIDAW_FFPROBE:'/path/ffprobe'}};}
test('setup merges both configurations, backs up exact originals and is idempotent',async t=>{
 const options=await fixture(t);await mkdir(join(options.root,'.codex'));const toml='# original comment\nmodel = "preserve-me"\n[mcp_servers.other]\ncommand="other"\n';const json=JSON.stringify({mcpServers:{other:{command:'other'}},custom:'keep'});
 await writeFile(join(options.root,'.codex/config.toml'),toml);await writeFile(join(options.root,'.mcp.json'),json);
 const result=await applyConfigs(await planConfigs(options),join(options.root,'backup'));assert.equal(await readFile(result[0].backup,'utf8'),toml);
 const codex=parse(await readFile(result[0].path,'utf8'));assert.equal(codex.model,'preserve-me');assert.equal(codex.mcp_servers.other.command,'other');assert.deepEqual(codex.mcp_servers.aidaw.env,options.env);
 const claude=JSON.parse(await readFile(result[1].path,'utf8'));assert.equal(claude.custom,'keep');assert.equal(claude.mcpServers.other.command,'other');assert.deepEqual(claude.mcpServers.aidaw.args,[join(options.root,'dist/mcp.js')]);assert.ok((await planConfigs(options)).every(p=>!p.changed));
});
test('malformed or conflicting config does not overwrite either client',async t=>{
 const options=await fixture(t);await writeFile(join(options.root,'.mcp.json'),'{bad');await assert.rejects(planConfigs(options));await assert.rejects(readFile(join(options.root,'.codex/config.toml')),/ENOENT/);
 await writeFile(join(options.root,'.mcp.json'),JSON.stringify({mcpServers:{aidaw:{env:{AIDAW_HOME:'/old-data'}}}}));await assert.rejects(planConfigs(options),/AIDAW_HOME differs/);
});
test('concurrent edits are detected and Windows paths round-trip',async t=>{
 const options=await fixture(t);options.env.AIDAW_HOME='C:\\Users\\Name With Space\\音源';const plans=await planConfigs(options);assert.equal(parse(plans[0].next).mcp_servers.aidaw.env.AIDAW_HOME,options.env.AIDAW_HOME);
 await writeFile(join(options.root,'.mcp.json'),'{}');await assert.rejects(applyConfigs(plans,join(options.root,'backup')),/changed during setup/);await assert.rejects(readFile(join(options.root,'.codex/config.toml')),/ENOENT/);
});
