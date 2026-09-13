import test from 'node:test';
import assert from 'node:assert/strict';
import {Service} from '../Build/JS/Application/service.js';
import {contributionTip} from '../Build/JS/Contracts/contribution.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('new projects return human contribution advice without publishing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-tip-')),s=new Service(root);try{const result=await s.create({project_id:'tip',name:'Tip',kind:'composition',bpm:120,length_ticks:3840,meter:[4,4]});assert.equal(result.tip,contributionTip);assert.match(result.tip,/プルリク/);assert.match(result.tip,/個人設定/);assert.equal((await s.readDocument('tip')).revision,0);}finally{await s.close();await rm(root,{recursive:true,force:true});}
});
