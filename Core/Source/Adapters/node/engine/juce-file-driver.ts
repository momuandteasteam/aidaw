import {releaseVersion} from '../../../Contracts/release.js';
import {homePaths} from '../workspace/home.js';
import {toJuceGraph} from './juce-plan.js';
import {atomicJson,readJson} from '../workspace/storage.js';
import type {ProcessorReference} from '../../../Contracts/audio-plan.js';
import { spawn } from 'node:child_process';
import { mkdir, access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {resolveEngineExecutable,resolveEngineSoundfont} from './engine-installation.js';
import {readPluginPackage} from './plugin-packages.js';
import { setTimeout as delay } from 'node:timers/promises';

export interface PlaybackMixChange { track_id?:string; bus_id?:string; mute?:boolean; solo?:boolean; gain_db?:number; pan?:number }

export class JuceFileWorker {
  private readonly explicitExecutable?:string;
  private readonly home?:string;
  private readonly fallbackExecutable?:string;
  constructor(executable?:string, options:{home?:string;fallbackExecutable?:string}={}) {
    this.explicitExecutable=executable;
    this.home=options.home??process.env.AIDAW_HOME;
    this.fallbackExecutable=options.fallbackExecutable;
  }
  // Metadata services can open a home before setup installs its audio executable.
  get executable():string { return this.explicitExecutable?resolve(this.explicitExecutable):resolveEngineExecutable(this.home,this.fallbackExecutable); }
  private get soundfont():string|undefined { return resolveEngineSoundfont(this.home,this.executable); }
  private async environment(){
    const bank=this.soundfont;
    if(bank&&this.home&&!process.env.AIDAW_SOUNDFONT){
      const installed=await readPluginPackage(join(this.home,'Plugins','Instruments','aidaw-gm'));
      const resource=installed.manifest.resources?.soundfont;
      if(installed.manifest.package_id!=='aidaw-gm'||installed.manifest.category!=='instrument'||!resource||resolve(installed.directory,resource.path)!==resolve(bank))throw new Error('Invalid managed GM soundfont package');
    }
    return {...process.env,AIDAW_SOUNDFONT:bank};
  }
  async resourceFingerprint(){const environment=await this.environment();return environment.AIDAW_SOUNDFONT?createHash('sha256').update(await readFile(environment.AIDAW_SOUNDFONT)).digest('hex'):'no-bank';}
  async call(request: unknown, options: { timeout?: number; signal?: AbortSignal; workDir?:string } = {}): Promise<any> {
    return this.callWorker(request,options);
  }
  async launchPlayback(request:unknown,paths:{input:string;response:string;control:string},options:{signal?:AbortSignal}={}){
    if(options.signal?.aborted)throw new Error('Playback cancelled');
    await access(this.executable);await mkdir(dirname(paths.input),{recursive:true});
    await writeFile(paths.input,JSON.stringify(request));await writeFile(paths.control,JSON.stringify({commands:[]}));
    if(options.signal?.aborted)throw new Error('Playback cancelled');
    const child=spawn(this.executable,[paths.input,paths.response],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe'],env:await this.environment()});
    let stderr='',sequence=0,writes=Promise.resolve();
    const lifecycle=new AbortController();
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000);});
    const stop=()=>child.kill('SIGKILL');options.signal?.addEventListener('abort',stop,{once:true});
    const done=new Promise<any>((accept,reject)=>child.once('error',reject).once('close',async code=>{
      options.signal?.removeEventListener('abort',stop);
      try{const response=JSON.parse(await readFile(paths.response,'utf8'));if(!response.ok)throw new Error(response.error||'Playback failed');if(code!==0)throw new Error(stderr||`Playback exited ${code}`);accept(response.result);}catch(error){reject(options.signal?.aborted?new Error('Playback cancelled'):error);}
    }));
    void done.then(()=>lifecycle.abort(),()=>lifecycle.abort());
    if(options.signal?.aborted)stop();
    const tick=()=>delay(10,undefined,{signal:lifecycle.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
    const ready=(async()=>{
      const deadline=Date.now()+180000;
      while(!lifecycle.signal.aborted&&Date.now()<deadline){
        try{const status=JSON.parse(await readFile((request as any).status_path,'utf8'));if(['playing','paused'].includes(status.state))return status;}catch{}
        await tick();
      }
      if(lifecycle.signal.aborted){await done;throw new Error('Playback ended before the audio device became ready');}
      // Never leave an unowned plug-in process running after readiness fails.
      stop();await done.catch(()=>{});throw new Error('Audio device and plug-ins did not become ready within 180 seconds');
    })();
    void ready.catch(()=>{});
    const command=(action:'pause'|'resume'|'seek'|'stop'|'set_mix'|'set_volume'|'select_comparison'|'replace_comparison',frame?:string,changes?:PlaybackMixChange[],gainDb?:number,slot?:number,path?:string)=>{
      const payload={...(path?{path}:{}),sequence:++sequence,action,...(slot!==undefined?{slot}:{}),...(frame!==undefined?{frame}:{}),...(changes!==undefined?{changes}:{}),...(gainDb!==undefined?{gain_db:gainDb}:{})};
      writes=writes.catch(()=>{}).then(async()=>{
        if(lifecycle.signal.aborted){await done;throw new Error('Playback has ended');}
        const temp=paths.control+`.${process.pid}.${payload.sequence}.tmp`;
        try{await writeFile(temp,JSON.stringify({commands:[payload]}));await rename(temp,paths.control);}finally{await rm(temp,{force:true});}
        for(let i=0;i<400;i++){
          let ack:any;try{ack=JSON.parse(await readFile((request as any).status_path,'utf8'));}catch{}
          if(ack?.control_sequence>=payload.sequence){if(ack.control_error)throw Error(ack.control_error);return;}
          if(lifecycle.signal.aborted){await done;throw new Error('Playback ended before the control was acknowledged');}
          await tick();
        }
        throw new Error('Playback control was not acknowledged');
      });return writes;
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
      const environment=await this.environment();
      await new Promise<void>((accept, reject) => {
        if (options.signal?.aborted) { reject(new Error('Job cancelled')); return; }
        const child = spawn(this.executable, [input, output], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
          env:environment });
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

import {createHash} from 'node:crypto';
import {EngineContractError,type EngineDriver,type EngineDescriptor,type EngineRequests,type EngineResults,type EngineOptions,type PlaybackRequest,type PlaybackSession,type PlaybackStatus} from '../../../Contracts/engine-contracts.js';
const nativeCommands={render:'render',analyze:'analyze',compareAudio:'compare_audio',discoverPlugins:'discover',scanPlugin:'scan',inspectPlugin:'inspect',loadModoBassPreset:'modo_bass_preset',loadKontaktPreset:'kontakt_preset',listAudioOutputs:'playback_devices'} as const;
/** The only adapter that understands JUCE JSON commands and status/control files. */
export class JuceFileDriver implements EngineDriver {
 private worker:JuceFileWorker;
 private readonly home?:string;
 private bindings:Record<string,{description_xml:string;version:string}>={};
 private descriptor?:Promise<EngineDescriptor>;
 constructor(executable?:string,options:{home?:string;fallbackExecutable?:string}={}){this.worker=new JuceFileWorker(executable,options);this.home=options.home??process.env.AIDAW_HOME;}
 private get bindingPath(){return this.home?join(homePaths(this.home).catalog,'Drivers','juce-file-driver.json'):undefined;}
 private async bindProcessor(p:ProcessorReference):Promise<object>{
  if(!this.bindings[p.plugin_id]&&this.bindingPath){try{this.bindings=await readJson(this.bindingPath);}catch(e:unknown){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  const binding=this.bindings[p.plugin_id];if(!binding)throw new EngineContractError('PROCESSOR_UNAVAILABLE',`Scan processor before use: ${p.plugin_id}`);
  if(p.plugin_version!==undefined&&p.plugin_version!==binding.version)throw new EngineContractError('PROCESSOR_STATE_INCOMPATIBLE','Processor version differs from scanned binding');
  return {...p,description_xml:binding.description_xml};
 }
 describe():Promise<EngineDescriptor>{
  return this.descriptor??=this.negotiate().catch(error=>{this.descriptor=undefined;throw error;});
 }
 private async negotiate():Promise<EngineDescriptor>{
  const caps=await this.worker.call({command:'capabilities'});
  if(caps.version!==releaseVersion||caps.sample_rate!==48000)throw new EngineContractError('CONTRACT_INCOMPATIBLE','Unsupported JUCE native protocol; install a matching driver');
  const content_fingerprint=createHash('sha256').update(await readFile(this.worker.executable)).update('juce-file-driver/'+releaseVersion).update(await this.worker.resourceFingerprint()).digest('hex');
  return {id:'aidaw.juce',version:caps.version,adapter_id:'juce-file-driver',adapter_version:releaseVersion,contract:{major:1,minor:0},content_fingerprint,features:[...Object.keys(nativeCommands).map(k=>k+'.v1'),'playback.v1',...(caps.playback_replace_comparison?['playback.replace_comparison.v1']:[]),...(caps.playback_prepared_comparison?['playback.prepared_comparison.v1']:[]),...(caps.playback_initial_pause?['playback.initial_pause.v1']:[]),...(caps.playback_position_switch?['playback.position_switch.v1']:[])],sample_rates:[48000],plugin_formats:caps.formats};
 }
 async invoke<K extends keyof EngineRequests>(operation:K,request:EngineRequests[K],options:EngineOptions={}):Promise<EngineResults[K]>{
  if(!Object.hasOwn(nativeCommands,operation))throw new EngineContractError('FEATURE_UNAVAILABLE','Unknown engine operation');
  let payload:object=request;
  if(operation==='render'){const r=request as EngineRequests['render'];if(r.plan.contract!=='aidaw.audio-plan'||r.plan.version!==1)throw new EngineContractError('CONTRACT_INCOMPATIBLE','Audio plan version 1 is required');const {plan,...rest}=r;payload={...rest,project:await toJuceGraph(plan,p=>this.bindProcessor(p))};}
  if(operation==='inspectPlugin'||operation==='loadModoBassPreset'||operation==='loadKontaktPreset'){const r=request as EngineRequests['inspectPlugin'];payload={...request,plugin:await this.bindProcessor(r.plugin)};}
  const result=await this.worker.call({...payload,command:nativeCommands[operation]},options);
  if(operation==='scanPlugin'){
    if(this.bindingPath){try{this.bindings={...await readJson(this.bindingPath),...this.bindings};}catch(e:unknown){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    result.plugins=result.plugins.map((p:Record<string,unknown>)=>{if(typeof p.plugin_id!=='string'||typeof p.description_xml!=='string'||typeof p.version!=='string')throw new EngineContractError('ENGINE_FAILED','Invalid scanned processor');this.bindings[p.plugin_id]={description_xml:p.description_xml,version:p.version};const {description_xml,...metadata}=p;return metadata;});
    if(this.bindingPath)await atomicJson(this.bindingPath,this.bindings);
  }
  if(!result||typeof result!=='object'||Array.isArray(result))throw new EngineContractError('ENGINE_FAILED','Invalid native response');
  return result as EngineResults[K];
 }
 async startPlayback(request:PlaybackRequest,options:EngineOptions={}):Promise<PlaybackSession>{
  if(options.signal?.aborted)throw new EngineContractError('CANCELLED','Playback cancelled');
  const base=options.workDir??tmpdir();await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,'playback-driver-')),statusPath=join(dir,'status.json');
  const paths={input:join(dir,'input.json'),response:join(dir,'response.json'),control:join(dir,'control.json')};
  let last:PlaybackStatus|undefined;
  if(request.plan.contract!=='aidaw.audio-plan'||request.plan.version!==1)throw new EngineContractError('CONTRACT_INCOMPATIBLE','Audio plan version 1 is required');
  const {plan,...payload}=request;
  const graph=await toJuceGraph(plan,p=>this.bindProcessor(p));
  if(request.prepared_comparison){Object.assign(graph,{tracks:[],buses:[],master_effects:[]});}
  const worker=await this.worker.launchPlayback({...payload,project:graph,command:'playback',status_path:statusPath,control_path:paths.control},paths,options);
  const status=async()=>{try{last=JSON.parse(await readFile(statusPath,'utf8'));}catch(e:unknown){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return last;};
  const done=worker.done.then(async result=>{await status();last={...last,...result};return last!;}).finally(()=>rm(dir,{recursive:true,force:true}));
  void done.catch(()=>{});
  const control=async(change:import('../../../Contracts/engine-contracts.js').PlaybackControl)=>{await worker.command(change.action,'frame' in change?change.frame:undefined,'changes' in change?change.changes:undefined,'gain_db' in change?change.gain_db:undefined,'slot' in change?change.slot:undefined,'path' in change?change.path:undefined);await status();};
  const close=async()=>{await worker.command('stop').catch(()=>{});await done.catch(()=>{});await rm(dir,{recursive:true,force:true});};
  return {ready:worker.ready,done,status,control,close};
 }
 async close(){}
}
