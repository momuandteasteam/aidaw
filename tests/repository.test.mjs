import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('runtime scripts are shared tools and private artifacts are ignored',async()=>{
 const entries=await readdir('scripts');assert.deepEqual(entries.sort(),['demo.mjs','public-check.mjs','setup','setup.mjs','setup.ps1','setup.sh'].sort());
 const paths=['.aidaw/test.wav','outputs/master.wav','.mcp.json','.codex/config.toml','.env','song.wav','build/bin/aidaw-engine'];const r=spawnSync('git',['check-ignore','--stdin'],{input:paths.join('\n')+'\n',encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout.trim().split('\n').length,paths.length);
 const personalMacPath=/\/Users\/(?!Shared(?:\/|:)|yourname\/|\.\.\.\/)[^/\s"']+\//;
 for(const folder of ['src','native'])for(const name of await readdir(folder)){const s=await readFile(join(folder,name),'utf8');assert.doesNotMatch(s,personalMacPath,name+' embeds a developer-specific path');}
});
test('distributed source and documentation contain no developer workspace paths or song-specific scripts',async()=>{
 const files=['AGENTS.md','CLAUDE.md','DESIGN.md','MASTERING.md','README.md','CMakeLists.txt','package.json',
  ...(await readdir('docs')).filter(n=>n.endsWith('.md')).map(n=>join('docs',n)),
  ...(await readdir('tests')).filter(n=>n.endsWith('.mjs')).map(n=>join('tests',n)),
  ...(await readdir('scripts')).filter(n=>n.endsWith('.mjs')).map(n=>join('scripts',n)),
  ...(await readdir('src')).map(n=>join('src',n)),...(await readdir('native')).map(n=>join('native',n))];
 const personalMacPath=/\/Users\/(?!Shared(?:\/|:)|yourname\/|\.\.\.\/)[^/\s"']+\//;
 for(const file of files){const text=await readFile(file,'utf8');assert.doesNotMatch(text,personalMacPath,`${file} contains a developer workspace path`);assert.doesNotMatch(text,/Mobile Documents\/com~apple/,`${file} contains an iCloud workspace path`);}
});
test('portable plugin catalog excludes machine paths, mutable state and current values',async()=>{
 const catalog=JSON.parse(await readFile('catalog/reference-plugins.json','utf8'));assert.equal(catalog.schema_version,1);assert.ok(catalog.plugins.length>0);
 const text=JSON.stringify(catalog);assert.doesNotMatch(text,/\/Users\/|\/Library\/Audio\/Plug-Ins|[A-Za-z]:\\Users\\/);assert.doesNotMatch(text,/"(?:location|description_xml|state_base64|value|display)"\s*:/);
 for(const p of catalog.plugins){assert.ok(p.plugin_id&&p.name&&p.vendor&&p.version&&p.format);assert.ok(Array.isArray(p.parameters)&&Array.isArray(p.programs)&&Array.isArray(p.buses));}
});
