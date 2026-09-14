import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {installPaths,replaceApp} from '../Tools/install-desktop.mjs';
test('desktop install paths expose an OS application entry',()=>{
 assert.equal(installPaths('darwin','/user').directory,'/Applications');
 assert.ok(installPaths('win32','/user',{LOCALAPPDATA:'/local',APPDATA:'/roaming'}).shortcut.endsWith('AIDAW DECK.lnk'));
 assert.ok(installPaths('linux','/user',{}).shortcut.endsWith('applications/aidaw-deck.desktop'));
 assert.throws(()=>installPaths('other','/user'));
});
test('failed validation preserves previous app and successful replacement preserves adjacent data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-install-')),source=join(root,'new'),target=join(root,'app');
 try{await mkdir(source);await mkdir(target);await writeFile(join(source,'version'),'new');await symlink('version',join(source,'current')); await writeFile(join(target,'version'),'old');await writeFile(join(root,'project'),'keep');
 await assert.rejects(replaceApp(source,target,async()=>{throw Error('invalid');}));assert.equal(await readFile(join(target,'version'),'utf8'),'old');
 await replaceApp(source,target);assert.equal(await readFile(join(target,'version'),'utf8'),'new');assert.equal(await readlink(join(target,'current')),'version');assert.equal(await readFile(join(root,'project'),'utf8'),'keep');
 }finally{await rm(root,{recursive:true,force:true});}
});
