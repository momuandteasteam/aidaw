import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkDocs} from '../Tools/check-docs.mjs';
import {createLocalApplication} from '../Build/JS/Application/local-application.js';
test('canonical documentation fits its reading budgets and every document has an entry route',async()=>{const result=await checkDocs();assert.ok(result.documents>10);assert.ok(result.entry_bytes<=1400);});
test('documentation gate catches context growth, duplicate owners, stale links and orphan documents',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-doc-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'Docs/Development'),{recursive:true});await mkdir(join(root,'Workflows'),{recursive:true});
 const docs=[['AGENTS.md','[task](Workflows/TASK.md)'],['CLAUDE.md','[entry](AGENTS.md)'],['README.md','[entry](AGENTS.md)'],['Workflows/TASK.md','# Task']];
 const manifest={version:1,documents:docs.map(([path],i)=>({path,role:i<3?'entry':'workflow',max_bytes:100,owns:['owner-'+i]}))};
 const save=()=>writeFile(join(root,'Docs/Development/documents.json'),JSON.stringify(manifest));
 for(const [path,text]of docs)await writeFile(join(root,path),text);await save();await checkDocs(root);
 await writeFile(join(root,'AGENTS.md'),'x'.repeat(101));await assert.rejects(checkDocs(root),/budget exceeded/);await writeFile(join(root,'AGENTS.md'),docs[0][1]);
 manifest.documents[1].owns=['owner-0'];await save();await assert.rejects(checkDocs(root),/Duplicate specification owner/);manifest.documents[1].owns=['owner-1'];await save();
 await writeFile(join(root,'Workflows/TASK.md'),'[stale](../Docs/deleted.md)');await assert.rejects(checkDocs(root),/Broken link/);await writeFile(join(root,'Workflows/TASK.md'),'# Task');
 await writeFile(join(root,'Docs/extra.md'),'# Unregistered');await assert.rejects(checkDocs(root),/Unregistered/);await rm(join(root,'Docs/extra.md'));
 await writeFile(join(root,'AGENTS.md'),'# No task route');await assert.rejects(checkDocs(root),/No entry route/);
 await writeFile(join(root,'AGENTS.md'),docs[0][1]);
 await writeFile(join(root,'Workflows/TASK.md'),'[requirements](../Docs/Development/REQUIREMENTS.md)');
 for(const name of ['REQUIREMENTS','VERIFICATION'])manifest.documents.push({path:`Docs/Development/${name}.md`,role:'development',max_bytes:300,owns:[name]});
 await writeFile(join(root,'Docs/Development/REQUIREMENTS.md'),'| R-001 | [verification](VERIFICATION.md) |');
 await writeFile(join(root,'Docs/Development/VERIFICATION.md'),'| R-001 | evidence |');await save();await checkDocs(root);
 await writeFile(join(root,'Docs/Development/VERIFICATION.md'),'| R-002 | stale evidence |');await assert.rejects(checkDocs(root),/Missing verification row/);

});
test('MCP guidance is bounded and scopes selection checks to authored project edits',()=>{
 const app=createLocalApplication({close:async()=>{}});assert.ok(Buffer.byteLength(app.instructions)<=1600);assert.match(app.instructions,/For authored project edits only/);assert.match(app.instructions,/Never silently replace/);
});
