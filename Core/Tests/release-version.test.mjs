import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {releaseVersion} from '../Build/JS/Contracts/release.js';
import {fixture} from './helpers.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
test('first-party core, GUI skins, controllers and chain share the initial release',async()=>{
 const pkg=await json('../package.json'),lock=await json('../package-lock.json');
 assert.equal(releaseVersion,'0.0.1');assert.equal(pkg.version,releaseVersion);assert.equal(lock.version,releaseVersion);assert.equal(lock.packages[''].version,releaseVersion);
 for(const name of ['deck','transport'])assert.equal((await import(`../../Plugins/Skins/${name}.mjs`)).manifest.version,releaseVersion);
 for(const name of ['ableton-push','novation-launch-control','ulanzi','stream-deck']){const m=await import(`../../Plugins/Controllers/${name}.mjs`);for(const p of m.profiles??[m.profile])assert.equal(p.version,releaseVersion);}
 const chain=await json('../../Workflows/Templates/EffectChains/aidaw-mastering-chain.json');assert.equal(chain.version,releaseVersion);for(const stage of chain.stages){assert.equal(stage.plugin.version,releaseVersion);assert.notEqual(stage.plugin.name,'AIDAW Exciter');}
});
test('native engine and API advertise the same product release',async t=>{
 const {api}=await fixture(t);const capabilities=await api('system_capabilities');assert.equal(capabilities.version,releaseVersion);
 // describe() rejects an incompatible native product version before returning.
 assert.equal(capabilities.engine.version,releaseVersion);assert.equal(capabilities.engine.adapter_version,releaseVersion);
});
