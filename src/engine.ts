import type { ProcessingQueue } from './processing-queue.js';
import { spawn } from 'node:child_process';
import { mkdir, access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
