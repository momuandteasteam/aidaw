import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256 } from './assets.js';
const run=promisify(execFile);
export async function measure(path:string){
 const hash=await sha256(path);
 const result=await run(process.env.AIDAW_FFMPEG??'ffmpeg',['-hide_banner','-nostats','-i',path,'-af','loudnorm=I=-14:TP=-1:LRA=11:print_format=json','-f','null','-'],{timeout:900000,maxBuffer:4*1024*1024});
 const blocks=result.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g);if(!blocks?.length)throw new Error('FFmpeg did not produce loudness measurements');const data=JSON.parse(blocks.at(-1)!);
 const value=(s:string)=>Number.isFinite(Number(s))?Number(s):null;
 if(await sha256(path)!==hash)throw new Error('Audio changed during measurement');
 return {audio_sha256:hash,integrated_lufs:value(data.input_i),true_peak_dbtp:value(data.input_tp),loudness_range_lu:value(data.input_lra),measurement:'FFmpeg loudnorm input measurements; no audio output or loudness target applied',listening_status:'not_assessed'};
}
