import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {designGate,checkDesignDiff} from '../Tools/design-gate.mjs';
test('design-first gate rejects absent design changes and accepts owned contract updates',()=>{
 assert.throws(()=>checkDesignDiff(['Core/Source/Application/x.ts','README.md']),/design update/);
 checkDesignDiff(['Core/Source/Application/x.ts','Docs/Contracts/APPLICATION.md']);
 checkDesignDiff(['README.md']);
});
test('design receipt rejects unready and modified documents and preserves re-finalization history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aidaw-design-'));try{
 for(const p of ['Docs/Contracts','Docs/Development','Workflows','Core/Source','Core/Tools','Core/Tests'])await mkdir(join(dir,p),{recursive:true});
 const docs=['AGENTS.md','CLAUDE.md','README.md','Docs/Contracts/TEST.md'];
 for(const p of docs)await writeFile(join(dir,p),p==='AGENTS.md'?'[design](Docs/Contracts/TEST.md)':'draft');
 await writeFile(join(dir,'Docs/Development/documents.json'),JSON.stringify({version:1,documents:docs.map(path=>({path,role:path.includes('Contracts')?'contract':'entry',max_bytes:1000,owns:[path]}))}));
 await assert.rejects(designGate(dir,'begin','x',['Docs/Contracts/TEST.md']),/not ready/);
 await assert.rejects(designGate(dir,'begin','../x',[]),/Invalid/);
 await writeFile(join(dir,'Docs/Contracts/TEST.md'),'Design status: ready\nBehavior and verification.');
 await designGate(dir,'begin','x',['Docs/Contracts/TEST.md']);await designGate(dir,'check','x');
 await writeFile(join(dir,'Docs/Contracts/TEST.md'),'Design status: ready\nChanged behavior.');
 await assert.rejects(designGate(dir,'check','x'),/Design changed/);
 await designGate(dir,'begin','x',['Docs/Contracts/TEST.md']);await designGate(dir,'check','x');
 }finally{await rm(dir,{recursive:true,force:true});}
});
