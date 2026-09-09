import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginInventory } from '../dist/plugin-inventory.js';

test('full inventory continues after a bad candidate and exports only portable metadata',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-inventory-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const plugins=[];
 const service={root,
  discover:async format=>({candidates:['/Library/Audio/Plug-Ins/VST3/Good.vst3',['','Users','private','Bad.vst3'].join('/')]}),
  scan:async(format,location)=>{if(location.includes('Bad'))throw Error(`cannot open ${location}`);const p={plugin_id:'VST3:Example:Good:1',name:'Good',vendor:'Example',version:'1.2.3',format,instrument:false,inputs:2,outputs:2,description_xml:'machine data',location};plugins.push(p);return {plugins:[p]};},
  catalog:async()=>({plugins,presets:[]}),
  resolvePlugin:async s=>({...s,plugin_version:'1.2.3',description_xml:'machine data'}),
  inspectPlugin:async()=>({parameters:[{id:'gain',name:'Gain',unit:'dB',value:.5,display:'0 dB',automatable:true,steps:0,choices:[]}],programs:[{index:0,name:'Default'}],buses:[{direction:'input',index:0,name:'Input',channels:2,enabled:true}],program_count:1}),
 };
 const inventory=new PluginInventory(service),result=await inventory.start(['VST3'],30);
 assert.equal(result.state,'succeeded');assert.deepEqual(result.summary,{candidates:2,candidates_scanned:2,candidates_succeeded:1,candidates_failed:1,plugins_found:1,plugins_parameter_indexed:1,plugins_metadata_failed:0});
 const portable=JSON.parse(await readFile(result.portable_catalog,'utf8'));assert.equal(portable.plugins[0].parameters[0].name,'Gain');assert.equal(portable.plugins[0].parameters[0].value,undefined);assert.equal(portable.plugins[0].location,undefined);assert.equal(portable.plugins[0].description_xml,undefined);assert.doesNotMatch(JSON.stringify(portable),/private/);
 assert.equal((await inventory.status(result.id)).summary.plugins_found,1);
});
test('reference search labels source metadata as unavailable until locally scanned',async()=>{
 const service={root:'/tmp/unused'},inventory=new PluginInventory(service),result=await inventory.searchReference('AIDAW Reverb',2);
 assert.equal(result.available,true);assert.ok(result.plugins.some(p=>p.name==='AIDAW Reverb'));assert.match(result.plugins[0].availability,/reference_only/);assert.ok(result.plugins[0].parameter_count>0);
});
