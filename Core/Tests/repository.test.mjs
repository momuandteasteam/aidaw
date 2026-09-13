import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
async function sourceFiles(folder){const out=[];for(const item of await readdir(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())out.push(...await sourceFiles(path));else out.push(path);}return out;}
function trackedFiles(prefix){
 const result=spawnSync('git',['ls-files','--',prefix],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return result.stdout.trim().split('\n').filter(Boolean);
}
test('runtime scripts are shared tools and private artifacts are ignored',async()=>{
 const paths=['Core/State/secret.json','Core/Build/Native/bin/aidaw-engine','Projects/test/project.json','.mcp.json','.codex/config.toml','.env','song.wav'];const r=spawnSync('git',['check-ignore','--stdin'],{input:paths.join('\n')+'\n',encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout.trim().split('\n').length,paths.length);
 const personalMacPath=/\/Users\/(?!Shared(?:\/|:)|yourname\/|\.\.\.\/)[^/\s"']+\//;
 for(const folder of ['Core/Source','Plugins/Controllers','Plugins/Skins'])for(const path of await sourceFiles(folder)){const s=await readFile(path,'utf8');assert.doesNotMatch(s,personalMacPath,path+' embeds a developer-specific path');}
});
test('distributed source and documentation contain no developer workspace paths or song-specific scripts',async()=>{
  const files=['AGENTS.md','CLAUDE.md','README.md','Core/CMakeLists.txt','Core/package.json',
  ...await sourceFiles('Docs'),...await sourceFiles('Workflows'),...await sourceFiles('Core/Source'),...await sourceFiles('Core/Tests'),...await sourceFiles('Core/Tools')];
 const personalMacPath=/\/Users\/(?!Shared(?:\/|:)|yourname\/|\.\.\.\/)[^/\s"']+\//;
 const personalWindowsPath=/[A-Za-z]:\\Users\\(?!yourname(?:\\|:)|Public(?:\\|:))[^\\\s"']+\\/i;
 for(const file of files.filter(file=>/\.(md|mjs|cjs|js|ts|cpp|h|html|css|json|txt|ps1|sh)$/.test(file))){const text=await readFile(file,'utf8');assert.doesNotMatch(text,personalMacPath,`${file} contains a developer workspace path`);assert.doesNotMatch(text,personalWindowsPath,`${file} contains a developer workspace path`);assert.doesNotMatch(text,/Mobile Documents\/com~apple/,`${file} contains an iCloud workspace path`);}
});
test('portable plugin catalog excludes machine paths, mutable state and current values',async()=>{
 const catalog=JSON.parse(await readFile('Libraries/Catalog/reference-plugins.json','utf8'));assert.equal(catalog.schema_version,1);assert.ok(catalog.plugins.length>0);
 const text=JSON.stringify(catalog);assert.doesNotMatch(text,/\/Users\/|\/Library\/Audio\/Plug-Ins|[A-Za-z]:\\Users\\/);assert.doesNotMatch(text,/"(?:location|description_xml|state_base64|value|display)"\s*:/);
 for(const p of catalog.plugins){assert.ok(p.plugin_id&&p.name&&p.vendor&&p.version&&p.format);assert.ok(Array.isArray(p.parameters)&&Array.isArray(p.programs)&&Array.isArray(p.buses));}
});
