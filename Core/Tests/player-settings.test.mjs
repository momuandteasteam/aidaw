import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeHome} from '../Build/JS/Adapters/node/workspace/home.js';
import {readPlayerPreferences,writePlayerPreferences} from '../Build/JS/Adapters/node/runtime/player-settings.js';

test('audio, MIDI mapping and custom layouts belong to their selected home',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-settings-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const a=initializeHome(join(root,'a')),b=initializeHome(join(root,'b'));
 const expected={encoderAssignments:{composition:{0:{rotate:'volume',press:'monitorMute'},3:{rotate:'none',press:'none'}}},skin:'transport',outputDevice:'test-device',controller:{profile:'ableton-push',input:'port-1',mappings:[{source:{type:'cc',channel:0,number:1},target:{kind:'encoder',index:1,mode:'absolute'}}]},customLayouts:{'composition:listen':{'13':'save'}}};
 await writePlayerPreferences(a.root,expected);
 assert.deepEqual(await readPlayerPreferences(a.root),expected);
 assert.deepEqual((await readPlayerPreferences(b.root)).customLayouts,{});
 assert.equal(JSON.parse(await readFile(join(a.settings,'controllers.json'),'utf8')).schema_version,1);
 await assert.rejects(writePlayerPreferences(a.root,{controller:{profile:123,input:'',mappings:[]}}),/Invalid/);
 assert.deepEqual(await readPlayerPreferences(a.root),expected);
});
