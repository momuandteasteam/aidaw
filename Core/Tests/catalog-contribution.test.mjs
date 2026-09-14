import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {contributionFromPortable,canonicalObservation,saveObservation,referenceObservations} from '../Build/JS/Adapters/node/catalog/catalog-contribution.js';
import {PluginInventory} from '../Build/JS/Adapters/node/catalog/plugin-inventory.js';
const portable=()=>({platform:'darwin',arch:'arm64',failures:['private failure'],plugins:[{plugin_id:'VST3:Example:EQ:1',name:'Example EQ',vendor:'Example',version:'1.0',format:'VST3',parameter_status:'host_readback',location:'/private/location',state_base64:'secret',programs:[{name:'My private preset'}],parameters:[{id:'gain',name:'Gain',unit:'dB',automatable:true,steps:0,value:.8,choices:['private choice']}]}]});
const make=()=>contributionFromPortable(portable(),['VST3:Example:EQ:1'])[0];
test('selected contribution excludes states, paths, presets, values and failures',()=>{
 const result=make(),serialized=JSON.stringify(result);assert.doesNotMatch(serialized,/private|secret|location|state_base64|programs|choices|value/);assert.equal(result.plugin.parameters[0].name,'Gain');
 assert.throws(()=>contributionFromPortable(portable(),[]));assert.throws(()=>contributionFromPortable(portable(),['unknown']));const p=portable();p.plugins[0].parameter_status='not_indexed';assert.throws(()=>contributionFromPortable(p,[p.plugins[0].plugin_id]));
});
test('strict contribution refuses private strings, unknown fields and duplicate IDs',()=>{
 let data=make();data.plugin.name='/home/user/private';assert.throws(()=>canonicalObservation(data));data=make();data.plugin.email='private@example.org';assert.throws(()=>canonicalObservation(data));data=make();data.plugin.parameters.push(data.plugin.parameters[0]);assert.throws(()=>canonicalObservation(data));data=make();data.plugin.name='private@example.org';assert.throws(()=>canonicalObservation(data));
});
test('accept is deterministic and retains OS and version observations separately',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-contribution-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const first=await saveObservation(root,make()),again=await saveObservation(root,make());assert.deepEqual(first,again);
 const other=make();other.platform='win32';other.arch='x64';await saveObservation(root,other);other.plugin.version='2.0';await saveObservation(root,other);assert.equal((await referenceObservations(root)).length,3);
 await writeFile(first.path,'corrupt');await assert.rejects(saveObservation(root,make()),/differs/);
});
test('reference search uses contributed observations without loading plugins',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-reference-')),old=process.env.AIDAW_REFERENCE_CATALOG;t.after(async()=>{if(old===undefined)delete process.env.AIDAW_REFERENCE_CATALOG;else process.env.AIDAW_REFERENCE_CATALOG=old;await rm(root,{recursive:true,force:true});});process.env.AIDAW_REFERENCE_CATALOG=join(root,'Libraries','Catalog','reference-plugins.json');
 await saveObservation(join(root,'Libraries','Catalog','Contributions'),make());
 const result=await new PluginInventory({}).searchReference('Gain',5);assert.equal(result.plugins.length,1);assert.equal(result.plugins[0].version,'1.0');assert.equal(result.plugins[0].platform,'darwin');assert.match(result.plugins[0].availability,/reference_only/);assert.equal(result.plugins[0].matched_parameters[0].id,'gain');
});

test('repository contributed observations satisfy strict metadata schema and hashes',async()=>{await referenceObservations(new URL('../../Libraries/Catalog/Contributions',import.meta.url).pathname);});
