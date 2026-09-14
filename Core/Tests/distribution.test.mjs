import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventory,verifyNative,buildDistribution} from '../Tools/build-distribution.mjs';
async function temp(t){const p=await mkdtemp(join(tmpdir(),'aidaw-dist-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
test('native binaries cannot be silently substituted across targets',async t=>{
 const root=await temp(t),p=join(root,'binary'),pe=Buffer.alloc(160);pe.write('MZ');pe.writeUInt32LE(80,0x3c);pe.writeUInt32LE(0x4550,80);pe.writeUInt16LE(0x8664,84);await writeFile(p,pe);
 await verifyNative(p,'win32','x64');await assert.rejects(verifyNative(p,'darwin','arm64'));
 const mach=Buffer.alloc(16);mach.writeUInt32LE(0xfeedfacf);mach.writeUInt32LE(0x100000c,4);await writeFile(p,mach);
 await verifyNative(p,'darwin','arm64');await assert.rejects(verifyNative(p,'darwin','x64'));await assert.rejects(verifyNative(p,'win32','x64'));
 await assert.rejects(buildDistribution({platform:'unsupported',arch:'x64'}),/target OS/);
});
test('distribution inventory detects modifications and rejects escaping links',async t=>{
 const root=await temp(t),p=join(root,'data');await writeFile(p,'before');const before=await inventory(root);
 await writeFile(p,'after');assert.notEqual((await inventory(root)).data.sha256,before.data.sha256);
 if(process.platform!=='win32'){await symlink('../outside',join(root,'bad'));await assert.rejects(inventory(root),/escapes/);}
});
