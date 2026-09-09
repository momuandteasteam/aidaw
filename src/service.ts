import { ProcessingQueue } from './processing-queue.js';
import { isBasicInstrument } from './instrument-policy.js';
import { renderMixer } from './mixer.js';
import { recover } from './delivery.js';
import { inputAsset, manifest, verifyAsset, contained, sha256 } from './assets.js';
import { layout, newJob, snapshot, revisionSnapshot } from './layout.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Engine } from './engine.js';
import { massiveXStateFromNks } from './nks.js';
import { atomicJson, locked, readJson } from './storage.js';
import { exportMidi } from './midi.js';
import { id, project, type Project, type Plugin, type Operation } from './schema.js';

interface Envelope { project: Project; receipts: Record<string, { fingerprint: string; revision: number; job_id?:string }> }
interface CatalogPlugin { plugin_id: string; name: string; vendor: string; version: string; format: string; instrument: boolean; description_xml: string; location: string }
interface Preset { id: string; name: string; tags: string[]; plugin_id: string; plugin_version: string; state_base64: string }
interface Catalog { plugins: CatalogPlugin[]; presets: Preset[] }
type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
interface Job { scope:'project'|'track'; track_id?:string; id: string; project_id: string; revision: number; state: JobState; owner_pid: number; output?: string; sha256?: string; analysis?: unknown; latency_compensation?: unknown; render_graph?:any[]; mixer?:any; insert_prints?:Record<string,string>; premaster?:string; instrument_prints?:Record<string,string>; stems?: Record<string, { output: string; analysis: any; latency_compensation: any; automation?: any }>; error?: string }
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class Service {
  readonly processing = new ProcessingQueue();
  readonly root: string;
  readonly engine: Engine;
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private renderReservations = 0;
  constructor(root = process.env.AIDAW_HOME ?? join(process.cwd(), '.aidaw'), engine = new Engine()) { this.root = resolve(root); this.engine = engine; this.engine.processing=this.processing; }
  dir(projectId: string) { return join(this.root, 'projects', id.parse(projectId)); }
  private async envelope(projectId: string): Promise<Envelope> {
    const e = await readJson<Envelope>(join(this.dir(projectId), 'project.json'));
    e.project = project.parse(e.project); return e;
  }
  async read(projectId: string) { return (await this.envelope(projectId)).project; }
  async create(args: { project_id: string; name: string; bpm: number; length_ticks: number; meter: [number, number]; duration_frames?:string; instrument_policy?:'plugin_first'|'allow_basic' }) {
    const dir = this.dir(args.project_id);
    const p = project.parse({ schema_version: 2, instrument_policy:args.instrument_policy, duration_frames:args.duration_frames, id: args.project_id, name: args.name, revision: 0, sample_rate: 48000, ppq: 960,
      bpm: args.bpm, meter: args.meter, length_ticks: args.length_ticks, tracks: [], sections: [], harmony: [], master_effects: [] });
    await mkdir(join(this.root, 'projects'), { recursive: true });
    await mkdir(dir); // Never overwrite a project, even from another process.
    await layout(dir); await snapshot(dir,p,{kind:'create'});
    await atomicJson(join(dir, 'project.json'), { project: p, receipts: {} });
    return { project_id: p.id, revision: p.revision };
  }
  async inspect(projectId: string, includeNotes = false) {
    const p = await this.read(projectId);
    const { tracks, master_effects, buses, ...rest } = p;
    const compact = (s: any) => { const { state_base64, ...v } = s; return { ...v, ...(state_base64 !== undefined ? { has_saved_state: true } : {}) }; };
    return { ...rest, buses:buses.map(b=>({...b,effects:b.effects.map(compact)})), master_effects: master_effects.map(compact), tracks: tracks.map(t => ({ ...t,
      instrument: compact(t.instrument), effects: t.effects.map(compact), note_count: t.notes.length, notes: includeNotes ? t.notes : undefined })) };
  }
  get catalogPath(){return join(this.root,'PluginLibrary.aidaw','state','host-catalog.json');}
  async catalog(): Promise<Catalog> {
    try { return await readJson(this.catalogPath); } catch (e: any) { if (e.code === 'ENOENT') {try{return await readJson(join(this.root,'catalog.json'));}catch(old:any){if(old.code==='ENOENT')return {plugins:[],presets:[]};throw old;}} throw e; }
  }
  async discover(format: string, searchPath?: string) { return this.engine.call({ command: 'discover', format, ...(searchPath ? { search_path: searchPath } : {}) }); }
  async scan(format: string, location: string) {
    // One worker per candidate; a crashing plugin cannot kill the control service.
    const result = await this.engine.call({ command: 'scan', format, location });
    await locked(join(this.root,'PluginLibrary.aidaw','temp','catalog.lock'), async () => {
      const c = await this.catalog();
      for (const p of result.plugins as CatalogPlugin[]) { c.plugins = c.plugins.filter(old => old.plugin_id !== p.plugin_id); c.plugins.push(p); }
      await atomicJson(this.catalogPath, c);
    });
    return { plugins: result.plugins.map(({ description_xml, ...p }: any) => ({ ...p, status: 'scanned_not_render_verified' })) };
  }
  async search(query: string, limit: number, instrumentOnly?: boolean, includeBasic=false) {
    const c = await this.catalog(), q = query.toLowerCase();
    const plugins = c.plugins.filter(p => (includeBasic || !isBasicInstrument({kind:'plugin',plugin_id:p.plugin_id+' '+p.name})) && `${p.name} ${p.vendor}`.toLowerCase().includes(q) && (instrumentOnly === undefined || p.instrument === instrumentOnly));
    const presets = c.presets.filter(p => (includeBasic || !isBasicInstrument({kind:'plugin',plugin_id:p.plugin_id+' '+c.plugins.find(x=>x.plugin_id===p.plugin_id)?.name})) && `${p.name} ${p.tags.join(' ')}`.toLowerCase().includes(q) &&
      (instrumentOnly === undefined || c.plugins.find(x => x.plugin_id === p.plugin_id)?.instrument === instrumentOnly));
    return { plugins: plugins.slice(0, limit).map(({ description_xml, ...p }) => p),
      presets: presets.slice(0, limit).map(({ state_base64, ...p }) => p), total_plugins: plugins.length, total_presets: presets.length,
      builtin_sounds: includeBasic ? ['sine', 'keys', 'bass', 'drums'].filter(s => s.includes(q)) : [] };
  }
  async resolvePlugin(s: Plugin) {
    const c = await this.catalog(); const found = c.plugins.find(p => p.plugin_id === s.plugin_id);
    if (!found) throw new Error(`Plugin not found on this machine: ${s.plugin_id}. Scan the matching format/version; AU is not interchangeable with VST3.`);
    if (s.plugin_version !== undefined && s.plugin_version !== found.version) throw new Error(`Plugin version mismatch: saved ${s.plugin_version}, installed ${found.version}`);
    let state = s.state_base64;
    if (!state && s.preset_id) {
      const preset = c.presets.find(p => p.id === s.preset_id && p.plugin_id === s.plugin_id);
      if (!preset) throw new Error(`Preset not found: ${s.preset_id}`);
      if (preset.plugin_version !== found.version) throw new Error(`Preset plugin version mismatch: ${preset.plugin_version} vs ${found.version}`);
      state = preset.state_base64;
    }
    return { ...s, plugin_version: found.version, ...(state !== undefined ? { state_base64: state } : {}), description_xml: found.description_xml };
  }
  async inspectPlugin(s: Plugin) {
    const { state_base64, ...result } = await this.engine.call({ command: 'inspect', plugin: await this.resolvePlugin(s) });
    return { ...result, state_available: typeof state_base64 === 'string' };
  }
  async capturePluginState(s: Plugin, workDir?:string) {
    const resolved=await this.resolvePlugin(s);
    const captured=await this.engine.call({command:'inspect',plugin:resolved},{workDir});
    if(typeof captured.state_base64!=='string')throw new Error('Plugin did not return a saved state');
    // Restore in a separate worker, without reapplying requested controls. Compare only
    // explicitly edited parameters: meters and free-running/random controls are not stable.
    if(s.parameters.length){
      const restored=await this.engine.call({command:'inspect',plugin:{...resolved,state_base64:captured.state_base64,parameters:[],program:undefined,preset_id:undefined}},{workDir});
      for(const requested of s.parameters){
        const before=captured.parameters.find((p:any)=>p.id===requested.id);
        const after=restored.parameters.find((p:any)=>p.id===requested.id);
        if(!before||!after||!Number.isFinite(before.value)||!Number.isFinite(after.value)||Math.abs(before.value-after.value)>0.001)
          throw new Error('Plugin saved state lost parameter '+requested.id+'; no project or preset was committed');
      }
    }
    return {resolved,captured};
  }
  async savePreset(s: Plugin, name: string, tags: string[]) {
    const {resolved,captured:result} = await this.capturePluginState(s);
    const preset: Preset = { id: randomUUID(), name, tags, plugin_id: s.plugin_id, plugin_version: resolved.plugin_version, state_base64: result.state_base64 };
    await locked(join(this.root,'PluginLibrary.aidaw','temp','catalog.lock'), async () => {
      const c = await this.catalog(); c.presets.push(preset); await atomicJson(this.catalogPath, c);
    });
    const { state_base64, ...metadata } = preset; return metadata;
  }
  async importModoPreset(s: Plugin, path: string, name: string, tags: string[]) {
    const resolved = await this.resolvePlugin(s);
    const result = await this.engine.call({ command: 'modo_bass_preset', plugin: resolved, path: resolve(path) });
    const preset: Preset = { id: randomUUID(), name, tags, plugin_id: s.plugin_id, plugin_version: resolved.plugin_version, state_base64: result.state_base64 };
    await locked(join(this.root,'PluginLibrary.aidaw','temp','catalog.lock'), async () => {
      const c = await this.catalog(); c.presets.push(preset); await atomicJson(this.catalogPath, c);
    });
    const { state_base64, ...metadata } = preset;
    return { ...metadata, model: result.model, play_style: result.play_style, properties_applied: result.properties_applied };
  }
  async importMassiveXPreset(s: Plugin, path: string, name: string, tags: string[]) {
    const resolved = await this.resolvePlugin(s);
    if (s.plugin_id !== 'VST3:Native Instruments:Massive X:bfb39c4e' || resolved.plugin_version !== '1.7.1 (R0)') throw new Error('NKS import is verified only for Massive X VST3 1.7.1 (R0)');
    const state_base64 = await massiveXStateFromNks(resolve(path));
    return this.savePreset({ kind: 'plugin', plugin_id: s.plugin_id, plugin_version: resolved.plugin_version, state_base64, parameters: s.parameters }, name, tags);
  }
  async freezePlugins(p: Project, workDir?:string) {
    const freeze = async (s: Plugin) => {
      // Store the concrete preset state in the portable project, not only a machine-local preset ID.
      if (s.state_base64 === undefined || s.program !== undefined || s.parameters.length > 0) {
        const {resolved,captured:result} = await this.capturePluginState(s,workDir);
        s.state_base64 = result.state_base64; s.plugin_version = resolved.plugin_version;
        s.parameters = []; delete s.program; delete s.preset_id;
      }
    };
    for (const t of p.tracks) { if (t.instrument.kind === 'plugin') await freeze(t.instrument); for (const fx of t.effects) await freeze(fx); }
    for (const bus of p.buses)for(const fx of bus.effects)await freeze(fx);
    for (const fx of p.master_effects) await freeze(fx);
  }
  async apply(args: { project_id: string; base_revision: number; request_id: string; operations: Operation[] }) {
    return this.change(args.project_id, args.base_revision, args.request_id, args, async p => {
      for (const op of args.operations) {
        const choice=op.op==='add_track'?op.track.instrument:op.op==='set_track'?op.changes.instrument:undefined;
        const selectedName=choice?.kind==='plugin'?(await this.catalog()).plugins.find(x=>x.plugin_id===choice.plugin_id)?.name:'';
        if(p.instrument_policy==='plugin_first'&&(isBasicInstrument(choice)||isBasicInstrument({kind:'plugin',plugin_id:selectedName??''})))throw new Error('Basic MIDI/builtin instruments require explicit instrument_policy=allow_basic at project creation. Inspect plugins and library patches first; never substitute silently.');
        if ('track_id' in op && !p.tracks.some(t => t.id === op.track_id)) throw new Error(`Unknown track: ${op.track_id}`);
        switch (op.op) {
          case 'set_timing':p.length_ticks=op.length_ticks;p.meter=op.meter;break;
          case 'set_bus':{const bus=p.buses.find(b=>b.id===op.bus_id);if(!bus)throw new Error('Unknown bus');Object.assign(bus,op.changes);break;}
          case 'set_buses': p.buses=structuredClone(op.buses);break;
          case 'set_duration_frames':p.duration_frames=op.duration_frames;break;
          case 'edit_audio_clip':{const t=p.tracks.find(t=>t.id===op.track_id)!;if(t.instrument.kind!=='audio')throw new Error('Not an audio clip');Object.assign(t.instrument,op.changes);if(op.changes.end_frame===null)delete t.instrument.end_frame;break;}
          case 'add_track': p.tracks.push(structuredClone(op.track)); break;
          case 'remove_track': p.tracks = p.tracks.filter(t => t.id !== op.track_id); break;
          case 'replace_notes': p.tracks.find(t => t.id === op.track_id)!.notes = structuredClone(op.notes); break;
          case 'set_track': Object.assign(p.tracks.find(t => t.id === op.track_id)!, structuredClone(op.changes)); break;
          case 'transpose_notes':
            if (op.end_tick <= op.start_tick) throw new Error('Invalid transpose range');
            for (const n of p.tracks.find(t => t.id === op.track_id)!.notes) if (n.tick >= op.start_tick && n.tick < op.end_tick) n.pitch += op.semitones;
            break;
          case 'set_master_effects': p.master_effects = structuredClone(op.effects); break;
          case 'set_sections': p.sections = structuredClone(op.sections); break;
          case 'set_harmony': p.harmony = structuredClone(op.harmony); break;
          case 'set_bpm': p.bpm = op.bpm; break;
        }
      }
      return p;
    });
  }
  private async change(projectId: string, base: number, requestId: string, payload: unknown, mutate: (p: Project) => Project | Promise<Project>) {
    id.parse(requestId); const dir = this.dir(projectId), hash = fingerprint(payload);
    return locked(join(dir,'temp','project.lock'), async () => {
      const e = await this.envelope(projectId); const prior = e.receipts[requestId];
      if (prior) { if (prior.fingerprint !== hash) throw new Error('request_id reused with different content'); return { project_id: projectId, revision: prior.revision, job_id:prior.job_id, replayed: true }; }
      if (e.project.revision !== base) throw new Error(`Revision conflict: expected ${base}, current ${e.project.revision}`);
      const job=await newJob(dir,{kind:'project_change',request_id:requestId,payload});
      await atomicJson(join(job.path,'snapshots','before.json'),e.project);
      let committed=false;
      try{
        let next=project.parse(await mutate(structuredClone(e.project)));next.revision=e.project.revision+1;
        await this.freezePlugins(next,join(job.path,'work'));next=project.parse(next);
        for(const t of next.tracks)if(t.instrument.kind==='audio')await this.resolveAudio(projectId,t.instrument,next.duration_frames??String(Math.round(next.length_ticks*60*48000/(next.bpm*960))));
        await atomicJson(join(job.path,'snapshots','after.json'),next);
        e.project=next;e.receipts[requestId]={fingerprint:hash,revision:next.revision,job_id:job.id};
        await atomicJson(join(dir,'project.json'),e);committed=true;
        await atomicJson(join(job.path,'status.json'),{id:job.id,state:'succeeded',revision:next.revision});
        return {project_id:projectId,revision:next.revision,job_id:job.id,replayed:false};
      }catch(error){await atomicJson(join(job.path,'status.json'),{id:job.id,state:committed?'succeeded':'failed',committed,error:String(error)});throw error;}

    });
  }
  async restore(args: { project_id: string; base_revision: number; request_id: string; revision: number }) {
    return this.change(args.project_id, args.base_revision, args.request_id, args, async () => {
      if (args.revision > args.base_revision) throw new Error('Cannot restore a future revision');
      return project.parse(await revisionSnapshot(this.dir(args.project_id), args.revision));
    });
  }
  async resolveAudio(projectId:string,a:any,duration?:string){const {asset,path}=await inputAsset(this.dir(projectId),a.asset_id);const end=a.end_frame??String(asset.audio!.frames);if(BigInt(end)>BigInt(String(asset.audio!.frames))||BigInt(a.start_frame)>=BigInt(end))throw new Error('Clip exceeds source');if(BigInt(a.fade_in_frames)+BigInt(a.fade_out_frames)>BigInt(end)-BigInt(a.start_frame))throw new Error('Fades exceed clip');if(duration!==undefined&&BigInt(a.timeline_frame)+BigInt(end)-BigInt(a.start_frame)>BigInt(duration))throw new Error('Project duration would truncate the audio clip; set end_frame explicitly');return {audio_source_path:path,audio_clip:{...a,end_frame:end}};}
  async resolvedProject(p: Project) {
    return { ...p, tracks: await Promise.all(p.tracks.map(async t => ({ ...t,
      ...(t.instrument.kind==='audio'?await this.resolveAudio(p.id,t.instrument,p.duration_frames??String(Math.round(p.length_ticks*60*48000/(p.bpm*960)))):{}),
      instrument: t.instrument.kind === 'plugin' ? await this.resolvePlugin(t.instrument) : t.instrument,
      effects: await Promise.all(t.effects.map(fx => this.resolvePlugin(fx))) }))),
      buses:await Promise.all(p.buses.map(async b=>({...b,effects:await Promise.all(b.effects.map(fx=>this.resolvePlugin(fx)))}))),
      master_effects: await Promise.all(p.master_effects.map(fx => this.resolvePlugin(fx))) };
  }
  async startRenderRequest(projectId:string,tail:number,trackId?:string,requestId?:string,rerenderTracks:string[]=[]){
    if(!requestId)return this.startRender(projectId,tail,trackId,rerenderTracks);id.parse(requestId);
    const dir=this.dir(projectId);return locked(join(dir,'temp','render-request.lock'),async()=>{
      const path=join(dir,'state','render-requests.json');let receipts:any={};try{receipts=await readJson(path);}catch(e:any){if(e.code!=='ENOENT')throw e;}
      const hash=fingerprint({tail,trackId,rerenderTracks});if(receipts[requestId]){if(receipts[requestId].fingerprint!==hash)throw new Error('request_id reused with different render settings');return {...receipts[requestId].result,replayed:true};}
      const result=await this.startRender(projectId,tail,trackId,rerenderTracks);receipts[requestId]={fingerprint:hash,result};await atomicJson(path,receipts);return result;
    });
  }
  async startRender(projectId: string, tail: number, trackId?: string,rerenderTracks:string[]=[]) {
    if (this.jobs.size + this.renderReservations >= 200) throw new Error('Processing queue is full (200 jobs)');
    ++this.renderReservations;
    try {
    let p = await this.read(projectId);
    if(rerenderTracks.some(id=>!p.tracks.some(t=>t.id===id)))throw new Error('Unknown rerender track');
    if (trackId) {
      const t = p.tracks.find(t => t.id === trackId); if (!t) throw new Error('Unknown track');
      p = { ...p, tracks: [{...t,sends:[]}], buses:[], master_effects: [] }; // A dry stem includes track inserts, but not shared master processing.
    }
    const resolved = await this.resolvedProject(p); // Pin complete state before dispatch.
    const job: Job = { scope:trackId?'track':'project',track_id:trackId,id: randomUUID(), project_id: p.id, revision: p.revision, state: 'queued', owner_pid: process.pid };
    const dir = (await newJob(this.dir(projectId),{kind:'render',project_id:projectId,tail,track_id:trackId},job.id)).path, output = join(dir, 'artifacts','audio.wav'), partial = join(dir, 'work','audio.partial.wav');
    await atomicJson(join(dir,'snapshots','assets.json'),await manifest(this.dir(projectId)));
    await atomicJson(join(dir, 'snapshots','input.json'), p); await atomicJson(join(dir, 'status.json'), job);
    const controller = new AbortController();
    const done = (async () => {
      try {
        await this.processing.run('render',async()=>{job.state='running';await atomicJson(join(dir,'status.json'),job);
        const options = { timeout: 15 * 60000, signal: controller.signal, workDir:join(dir,'work') };
        let renderProject = resolved;
        if(resolved.tracks.length){const mixed=await renderMixer(this,resolved,dir,tail,{...options,rerender_tracks:rerenderTracks});const {renderProject:compiled,...data}=mixed;Object.assign(job,data);renderProject=compiled;}
        const result = await this.engine.call({ command: 'render', project: renderProject, output: partial, tail_seconds: tail }, options);
        if (job.stems) result.latency_compensation = { ...result.latency_compensation, final_write_trimmed_samples:result.latency_compensation.trimmed_samples, trimmed_samples:result.latency_compensation.trimmed_samples+Math.max(0,...Object.values(job.stems).map(s=>s.latency_compensation.trimmed_samples)), method: 'tracks compensated independently before summing; master compensated at final write', stem_latency: Object.fromEntries(Object.entries(job.stems).map(([id, stem]) => [id, stem.latency_compensation])) };
        if (controller.signal.aborted) throw new Error('Job cancelled');
        const digest = createHash('sha256'); for await (const bytes of createReadStream(partial)) digest.update(bytes);
        const hash = digest.digest('hex');
        if (controller.signal.aborted) throw new Error('Job cancelled');
        for(const t of p.tracks)if(t.instrument.kind==='audio')await inputAsset(this.dir(projectId),t.instrument.asset_id);
        await rename(partial, output); job.state = 'succeeded'; job.output = output; job.sha256 = hash; job.analysis = result.analysis;
        job.latency_compensation = result.latency_compensation;
        const frozen:any={revision:p.revision,master:'',tracks:{},instrument_prints:{},sample_rate:48000};
        const saveFrozen=async(path:string)=>{const hash=await sha256(path),relative=`state/frozen/${hash}.wav`;await copyFile(path,join(this.dir(projectId),relative));return relative;};
        frozen.master=await saveFrozen(output);for(const[id,stem]of Object.entries(job.stems??{}))frozen.tracks[id]=await saveFrozen(stem.output);for(const[id,path]of Object.entries(job.instrument_prints??{}))frozen.instrument_prints[id]=await saveFrozen(path);
        await locked(join(this.dir(projectId),'temp','project.lock'),async()=>{if(!trackId&&(await this.read(projectId)).revision===p.revision){await atomicJson(join(this.dir(projectId),'state','frozen.json'),frozen);if(job.mixer)await atomicJson(join(this.dir(projectId),'state','mixer.json'),job.mixer);}});
        },{id:job.id,signal:controller.signal});
      } catch (e) { job.state = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = String(e); await rm(partial, { force: true }); }
      finally { try{await atomicJson(join(dir, 'status.json'), job);}finally{this.jobs.delete(job.id);} }
    })();
    void done.catch(()=>{}); // Persistence errors remain observable via wait without an unhandled rejection.
    this.jobs.set(job.id, { controller, done }); return { job_id: job.id, revision: job.revision, state: job.state };
    } finally { --this.renderReservations; }
  }
  async findJob(jobId:string) {
    const library=join(this.root,'PluginLibrary.aidaw','jobs',id.parse(jobId),'status.json');try{await readFile(library);return library;}catch(e:any){if(e.code!=='ENOENT')throw e;}
    let names:string[]=[];try{names=await readdir(join(this.root,'projects'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
    for(const name of names) {
      if(!id.safeParse(name).success)continue;
      const path=join(this.dir(name),'jobs',jobId,'status.json');
      try { await readFile(path); return path; } catch(e:any){if(e.code!=='ENOENT')throw e;}
    }
    return join(this.root,'jobs',jobId,'job.json');
  }
  async jobStatus(jobId: string) {
    const jobPath = await this.findJob(id.parse(jobId)); const job = await readJson<Job>(jobPath);
    if ((job.state === 'running'||job.state==='queued') && job.owner_pid && !this.jobs.has(jobId)) {
      try { process.kill(job.owner_pid, 0); }
      catch (e: any) { if (e.code === 'ESRCH') { job.state = 'failed'; job.error = 'Owner process stopped before the job completed'; await atomicJson(jobPath, job); } }
    }
    return job;
  }
  async cancel(jobId: string) {
    const running = this.jobs.get(id.parse(jobId));
    if (!running) { const job = await this.jobStatus(jobId); if (job.state === 'running') throw new Error('Cancel through the MCP service that owns this job'); return job; }
    running.controller.abort(); await running.done; return this.jobStatus(jobId);
  }
  trackBackground(jobId:string,controller:AbortController,done:Promise<void>){this.jobs.set(jobId,{controller,done});void done.finally(()=>this.jobs.delete(jobId)).catch(()=>{});}
  async wait(jobId: string) { await this.jobs.get(jobId)?.done; return this.jobStatus(jobId); }
  async close() { this.processing.shutdown(); const pending = [...this.jobs.values()]; for (const j of pending) j.controller.abort(); await Promise.allSettled(pending.map(j => j.done)); await this.processing.idle(); }
  async exportNotationMidi(projectId:string){const p=await this.read(projectId);p.tracks=p.tracks.map(t=>({...t,notes:t.notes.filter(n=>n.purpose!=='keyswitch').map(n=>({...n,pitch:n.display_pitch??n.pitch}))}));const output=join(this.dir(projectId),'outputs','MIDI','notation.mid');await writeFile(output,exportMidi(p));return {output,revision:p.revision,role:'notation_not_plugin_performance'};}
  async exportMidi(projectId: string) {
    const p = await this.read(projectId), output = join(this.dir(projectId), 'outputs','MIDI','performance.mid');
    await mkdir(join(this.dir(projectId), 'outputs','MIDI'), { recursive: true }); await writeFile(output, exportMidi(p));
    return { output, revision: p.revision, notes: p.tracks.reduce((sum, t) => sum + t.notes.length, 0) };
  }
  async exportProject(projectId: string) {
    const p = await this.read(projectId), output = join(this.dir(projectId), 'outputs','project','project.aidaw.json');
    await atomicJson(output, p); return { output, revision: p.revision, contains: 'notes, structure, plugin state; plugin binaries and sample libraries are external' };
  }
  async importProject(data: unknown, projectId: string) {
    const p = project.parse({ ...project.parse(data), id: id.parse(projectId), revision: 0 });
    const dir = this.dir(projectId); await mkdir(join(this.root, 'projects'), { recursive: true }); await mkdir(dir);
    await layout(dir); await snapshot(dir,p,{kind:'create'});
    await atomicJson(join(dir, 'project.json'), { project: p, receipts: {} });
    return { project_id: projectId, revision: 0, plugins_checked: false };
  }
  async recoverDelivery(projectId:string){return locked(join(this.dir(projectId),'temp','publish.lock'),async()=>{await recover(this.dir(projectId));return {recovered:true};});}
  async validate(projectId:string){
    const p=await this.read(projectId),dir=this.dir(projectId),issues:string[]=[];
    for(const a of (await manifest(dir)).assets)try{await verifyAsset(dir,a);}catch(e){issues.push(String(e));}
    try{await this.resolvedProject(p);}catch(e){issues.push(String(e));}
    let frozen_audio:string|undefined;
    try{const f=await readJson(join(dir,'state','frozen.json'));if(f.revision===p.revision){const path=await contained(dir,f.master);if(path.endsWith(`${await sha256(path)}.wav`))frozen_audio=path;else issues.push('Frozen audio hash mismatch');}}
    catch(e:any){if(e.code!=='ENOENT')issues.push(String(e));}
    return {project_id:projectId,revision:p.revision,dependencies_resolved:issues.length===0,issues,frozen_audio,playback_mode:frozen_audio?'frozen_available':'live_render_required',render_compatibility:'not_certified_by_dependency_resolution'};
  }
  async listProjects() {
    let names: string[]; try { names = await readdir(join(this.root, 'projects')); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
    return Promise.all(names.filter(name => id.safeParse(name).success).map(async name => {
      const p = await this.read(name); return { project_id: p.id, name: p.name, revision: p.revision };
    }));
  }
}
