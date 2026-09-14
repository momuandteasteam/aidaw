import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {importFile} from '../Build/JS/Application/file-import.js';
test('file import retains original audio, normalizes and stores image artwork separately',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-file-import-'));let analyses=0;
 const service={dir:()=>root,readDocument:async()=>({}),engine:{analyze:async({path})=>{analyses++;const data=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_streams','-of','json',path]));assert.equal(data.streams[0].sample_rate,'48000');return {sample_rate:48000};}}};
 try{const path=join(root,'Song.mp3');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=duration=0.1','-ar','44100',path]);const result=await importFile(service,'p',path);assert.equal(result.role,'source');assert.equal(result.name,'Song.wav');assert.deepEqual(await readFile(result.original_path),await readFile(path));assert.deepEqual((await readdir(join(root,'temp'))).filter(n=>n.startsWith('import-')),[]);
 const image=join(root,'cover.png');await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'));assert.equal((await importFile(service,'p',image)).role,'artwork');assert.equal(analyses,1);await assert.rejects(importFile(service,'p','file.exe'),/Unsupported/);
 }finally{await rm(root,{recursive:true,force:true});}
});
