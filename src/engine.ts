import type { ProcessingQueue } from './processing-queue.js';
import { spawn } from 'node:child_process';
import { mkdir, access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class Engine {
  readonly executable: string;
  processing?:ProcessingQueue;
  constructor(executable = process.env.AIDAW_ENGINE ?? fileURLToPath(new URL(`../build/bin/aidaw-engine${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))) {
    this.executable = resolve(executable);
  }
  async call(request: unknown, options: { timeout?: number; signal?: AbortSignal; workDir?:string } = {}): Promise<any> {
    const invoke=()=>this.callWorker(request,{...options,signal:options.signal??this.processing?.signal});
    return this.processing&&(request as any)?.command!=='capabilities'?this.processing.run('native_'+(request as any)?.command,invoke,{signal:options.signal}):invoke();
  }
  async launchPlayback(request:unknown,paths:{input:string;response:string;control:string},options:{signal?:AbortSignal}={}){
    await access(this.executable);await mkdir(dirname(paths.input),{recursive:true});
    await writeFile(paths.input,JSON.stringify(request));await writeFile(paths.control,JSON.stringify({commands:[]}));
    const child=spawn(this.executable,[paths.input,paths.response],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,AIDAW_SOUNDFONT:process.env.AIDAW_SOUNDFONT??resolve(dirname(this.executable),'../starter-assets/FluidR3_GM.sf2')}});
    let stderr='',sequence=0,writes=Promise.resolve();const commands:Array<{sequence:number;action:string;frame?:string}>=[];
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000);});
    const stop=()=>child.kill('SIGKILL');options.signal?.addEventListener('abort',stop,{once:true});
    const done=new Promise<any>((accept,reject)=>child.once('error',reject).once('close',async code=>{
      options.signal?.removeEventListener('abort',stop);
      try{const response=JSON.parse(await readFile(paths.response,'utf8'));if(!response.ok)throw new Error(response.error||'Playback failed');if(code!==0)throw new Error(stderr||`Playback exited ${code}`);accept(response.result);}catch(error){reject(options.signal?.aborted?new Error('Playback cancelled'):error);}
    }));
    const ready=Promise.race([(async()=>{for(let i=0;i<18000;i++){try{const status=JSON.parse(await readFile((request as any).status_path,'utf8'));if(['playing','paused'].includes(status.state))return status;}catch{}await new Promise(r=>setTimeout(r,10));}throw new Error('Audio device and plug-ins did not become ready within 180 seconds');})(),done.then(()=>{throw new Error('Playback ended before the audio device became ready');})]);
    const command=(action:'pause'|'resume'|'seek'|'stop',frame?:string)=>{
      const payload={sequence:++sequence,action,...(frame!==undefined?{frame}:{})};commands.push(payload);
      writes=writes.then(async()=>{const temp=paths.control+`.${process.pid}.${payload.sequence}.tmp`;await writeFile(temp,JSON.stringify({commands}));await rename(temp,paths.control);
        for(let i=0;i<200;i++){try{const status=JSON.parse(await readFile((request as any).status_path,'utf8'));if(status.control_sequence>=payload.sequence)return;}catch{}await new Promise(r=>setTimeout(r,10));}throw new Error('Playback control was not acknowledged');});return writes;
    };
    return {pid:child.pid,ready,done,command};
  }
  private async callWorker(request:unknown,options:{timeout?:number;signal?:AbortSignal;workDir?:string}):Promise<any>{
    await access(this.executable);
    if(options.workDir)await mkdir(options.workDir,{recursive:true});
    const dir = await mkdtemp(join(options.workDir ?? tmpdir(), 'aidaw-worker-'));
    const input = join(dir, 'request.json'), output = join(dir, 'response.json');
    try {
      await writeFile(input, JSON.stringify(request));
      await new Promise<void>((accept, reject) => {
        if (options.signal?.aborted) { reject(new Error('Job cancelled')); return; }
        const child = spawn(this.executable, [input, output], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
          env:{...process.env,AIDAW_SOUNDFONT:process.env.AIDAW_SOUNDFONT??resolve(dirname(this.executable),'../starter-assets/FluidR3_GM.sf2')} });
        let stderr = '', reason = '';
        child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-4000); });
        const stop = () => { reason = 'Job cancelled'; child.kill('SIGKILL'); };
        options.signal?.addEventListener('abort', stop, { once: true });
        const timer = setTimeout(() => { reason = 'Engine timeout'; child.kill('SIGKILL'); }, options.timeout ?? 30000);
        child.on('error', reject);
        child.on('close', async (_code, signal) => {
          clearTimeout(timer); options.signal?.removeEventListener('abort', stop);
          if (reason || signal) { reject(new Error(reason || `Engine terminated (${signal}): ${stderr}`)); return; }
          try { await access(output); accept(); }
          catch { reject(new Error(`Engine exited without a response: ${stderr}`)); }
        });
      });
      const response = JSON.parse(await readFile(output, 'utf8'));
      if (!response.ok) throw new Error(response.error ?? 'Engine failed');
      return response.result;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
}
