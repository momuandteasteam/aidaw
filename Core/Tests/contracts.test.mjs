import test from 'node:test';
import assert from 'node:assert/strict';
import {negotiateContract,DocumentReader} from '../Build/JS/Contracts/version.js';
test('independent contracts negotiate only mutual features and reject incompatible majors',()=>{
 const local={contract:'aidaw.engine',version:{major:1,minor:3},features:['play','seek','export']};
 assert.deepEqual(negotiateContract(local,{...local,version:{major:1,minor:1},features:['play','seek']},['play']).features,['play','seek']);
 assert.throws(()=>negotiateContract(local,{...local,version:{major:2,minor:0}}),{code:'CONTRACT_INCOMPATIBLE'});
 assert.throws(()=>negotiateContract(local,{...local,features:['play']},['export']),{code:'CONTRACT_INCOMPATIBLE'});
});
test('document conversion requires an explicitly registered and validating decoder',()=>{
 const reader=new DocumentReader('aidaw.document').register({major:1,minor:0},payload=>{assert.equal(typeof payload.title,'string');return {name:payload.title};});
 assert.deepEqual(reader.read({contract:'aidaw.document',version:{major:1,minor:0},payload:{title:'Album'}}),{name:'Album'});
 assert.throws(()=>reader.read({contract:'aidaw.document',version:{major:2,minor:0},payload:{title:'Album'}}),{code:'CONTRACT_INCOMPATIBLE'});
 assert.throws(()=>reader.read({contract:'aidaw.document',version:{major:1,minor:0},payload:{title:42}}));
});
