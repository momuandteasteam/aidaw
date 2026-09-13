import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkLayout,workspaceRoot} from '../Tools/check-layout.mjs';
test('workspace obeys the canonical directory contract',async()=>{await checkLayout(workspaceRoot);});
test('directory contract rejects Home and unapproved root or extension directories',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-layout-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const path of ['Home','apps','.unapproved','Plugins/Random']){await mkdir(join(root,path),{recursive:true});await assert.rejects(checkLayout(root),/Unexpected/);await rm(join(root,path),{recursive:true});}
});
