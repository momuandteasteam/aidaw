import type {SeparationPort} from '../Contracts/separation.js';
import {SpleeterSeparator} from '../Adapters/node/media/spleeter.js';
import {contributionTip} from '../Contracts/contribution.js';
import type { WorkspacePort } from '../Contracts/workspace.js';
import { NodeWorkspace } from '../Adapters/node/workspace/node-workspace.js';
import {audioPlan} from '../Contracts/engine-contracts.js';
import {withAudioQueue} from './queued-engine.js';
import type {EnginePort,PlaybackSession} from '../Contracts/engine-contracts.js';
import { discoverManagedPlugins } from '../Adapters/node/engine/plugin-packages.js';
import { defaultWorkspaceRoot, homePaths, initializeHome, type HomePaths } from '../Adapters/node/workspace/home.js';
import { getActiveContext, setActiveContext, type activeContextInput } from '../Adapters/node/runtime/active-context.js';
import type { z } from 'zod';
import { parseDocument, compositionFromGraph, compileDocument, applyDocumentOperations, resolveMasteringTarget } from '../Domain/domain.js';
import { ProcessingQueue } from '../Adapters/node/runtime/processing-queue.js';
import { isBasicInstrument } from '../Adapters/node/catalog/instrument-policy.js';
import { renderMixer } from './mixer.js';
import { recover } from './delivery.js';
import { inputAsset, manifest, verifyAsset, contained, sha256 } from '../Adapters/node/workspace/assets.js';
import { newJob } from '../Adapters/node/workspace/layout.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Engine } from '../Adapters/node/engine/engine.js';
import { massiveXStateFromNks } from '../Adapters/node/catalog/nks.js';
import { atomicJson, locked, readJson } from '../Adapters/node/workspace/storage.js';
import { exportMidi } from '../Adapters/node/media/midi.js';
import { id, project, type Project, type Plugin, type Operation } from '../Domain/schema.js';

interface CatalogPlugin { plugin_id: string; name: string; vendor: string; version: string; format: string; instrument: boolean; location: string }
interface Preset { id: string; name: string; tags: string[]; plugin_id: string; plugin_version: string; state_base64: string }
interface Catalog { plugins: CatalogPlugin[]; presets: Preset[] }
type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
interface Job { scope:'project'|'track'; track_id?:string; id: string; project_id: string; revision: number; state: JobState; owner_pid: number; output?: string; sha256?: string; analysis?: unknown; latency_compensation?: unknown; render_graph?:any[]; mixer?:any; insert_prints?:Record<string,string>; premaster?:string; instrument_prints?:Record<string,string>; stems?: Record<string, { output: string; analysis: any; latency_compensation: any; automation?: any }>; error?: string }
interface Playback {track_ids?:Set<string>;bus_ids?:Set<string>;kind?:'composition'|'mastering'|'separation';target?:{song_id?:string;version_id?:string;comparison?:'a'|'b';source_asset_id?:string;tail_seconds?:number;selection?:{kind:'source'|'version';version_id?:string;source_asset_id?:string}};id:string;project_id:string;revision:number;state:'queued'|'starting'|'playing'|'paused'|'stopped'|'completed'|'failed'|'cancelled';owner_pid:number;created_at:string;jobPath:string;controller:AbortController;worker?:PlaybackSession;done:Promise<void>;error?:string }
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class Service {
  readonly processing:ProcessingQueue;
  readonly root: string;
  readonly paths: HomePaths;
  readonly workspace: WorkspacePort<ReturnType<typeof parseDocument>>;
  readonly engine: EnginePort;
  readonly separator:SeparationPort;
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private playback?:Playback;
  private playbackStarting = false;
  private renderReservations = 0;
  constructor(root = process.env.AIDAW_HOME ?? defaultWorkspaceRoot(), engine:EnginePort = new Engine(undefined,{home:root}), options:{workspace?:WorkspacePort<ReturnType<typeof parseDocument>>;separator?:SeparationPort}={}) { this.root = resolve(root); this.separator=options.separator??new SpleeterSeparator(this.root); this.paths=options.workspace?homePaths(this.root):initializeHome(this.root); this.workspace=options.workspace??new NodeWorkspace(this.root); this.processing=new ProcessingQueue(this.root); this.engine = withAudioQueue(engine,this.processing); }
  dir(projectId: string) { return join(this.paths.projects, id.parse(projectId)); }
  async readDocument(projectId:string) { return this.workspace.read(projectId); }
  async activeContext() { return getActiveContext(this); }
  async selectActiveContext(selection: z.infer<typeof activeContextInput>) { return setActiveContext(this, selection); }
  async compileGraph(projectId:string, selection:{revision?:number;song_id?:string;version_id?:string;comparison?:'a'|'b'}={}) {
    const doc = selection.revision === undefined ? await this.readDocument(projectId) : await this.workspace.readRevision(projectId,selection.revision);
    return compileDocument({...doc,id:projectId},selection);
  }
  async read(projectId: string) { return this.compileGraph(projectId); }
  async history(projectId:string,offset=0,limit=50) {return this.workspace.history(projectId,offset,limit);}

  async create(args: { project_id: string; name: string; bpm: number; length_ticks: number; meter: [number, number]; duration_frames?:string; instrument_policy?:'plugin_first'|'allow_basic';kind?:'composition'|'mastering'|'separation' }) {
    const p = project.parse({ schema_version: 2, instrument_policy:args.instrument_policy, duration_frames:args.duration_frames, id: args.project_id, name: args.name, revision: 0, sample_rate: 48000, ppq: 960,
      bpm: args.bpm, meter: args.meter, length_ticks: args.length_ticks, tracks: [], sections: [], harmony: [], master_effects: [] });
    const doc = args.kind === 'mastering' ? parseDocument({schema_version:3,kind:'mastering',id:p.id,name:p.name,revision:0,instrument_policy:p.instrument_policy,mastering:{song_order:[],songs:[]}}) : args.kind==='separation'?parseDocument({...compositionFromGraph(p),kind:'separation',separation:{}}):compositionFromGraph(p);
    await this.workspace.create(doc);
    return { project_id: p.id, revision: p.revision, tip:contributionTip };
  }
  async inspect(projectId: string, includeNotes = false) {
    const p = await this.read(projectId);
    const { tracks, master_effects, buses, ...rest } = p;
    const compact = (s: any) => { const { state_base64, ...v } = s; return { ...v, ...(state_base64 !== undefined ? { has_saved_state: true } : {}) }; };
    return { ...rest, buses:buses.map(b=>({...b,effects:b.effects.map(compact)})), master_effects: master_effects.map(compact), tracks: tracks.map(t => ({ ...t,
      instrument: compact(t.instrument), effects: t.effects.map(compact), note_count: t.notes.length, notes: includeNotes ? t.notes : undefined })) };
  }
  get catalogPath(){return join(this.paths.catalog,'state','host-catalog.json');}
  async catalog(): Promise<Catalog> {
    try { return await readJson(this.catalogPath); } catch (e: any) { if (e.code === 'ENOENT') {try{return await readJson(join(this.root,'catalog.json'));}catch(old:any){if(old.code==='ENOENT')return {plugins:[],presets:[]};throw old;}} throw e; }
  }
  async discover(format: string, searchPath?: string) {
    const found=await this.engine.discoverPlugins({ format, ...(searchPath ? { search_path: searchPath } : {}) });
    if(format!=='VST3'||searchPath)return found;
    const managed=await discoverManagedPlugins(this.root);
    return {...found,candidates:[...new Set([...found.candidates,...managed.candidates])],managed_errors:managed.errors};
  }
  async scan(format: string, location: string) {
    // One worker per candidate; a crashing plugin cannot kill the control service.
    const result = await this.engine.scanPlugin({ format, location });
    await locked(join(this.paths.catalog,'temp','catalog.lock'), async () => {
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
    return { plugins: plugins.slice(0, limit),
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
    return { ...s, plugin_version: found.version, ...(state !== undefined ? { state_base64: state } : {}) };
  }
  async inspectPlugin(s: Plugin) {
    const { state_base64, ...result } = await this.engine.inspectPlugin({ plugin: await this.resolvePlugin(s) });
    return { ...result, state_available: typeof state_base64 === 'string' };
  }
  async capturePluginState(s: Plugin, workDir?:string) {
    const resolved=await this.resolvePlugin(s);
    const captured=await this.engine.inspectPlugin({plugin:resolved},{workDir});
    if(typeof captured.state_base64!=='string')throw new Error('Plugin did not return a saved state');
    // Restore in a separate worker, without reapplying requested controls. Compare only
    // explicitly edited parameters: meters and free-running/random controls are not stable.
    if(s.parameters.length){
      const restored=await this.engine.inspectPlugin({plugin:{...resolved,state_base64:captured.state_base64,parameters:[],program:undefined}},{workDir});
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
    await locked(join(this.paths.catalog,'temp','catalog.lock'), async () => {
      const c = await this.catalog(); c.presets.push(preset); await atomicJson(this.catalogPath, c);
    });
    const { state_base64, ...metadata } = preset; return metadata;
  }
  async importModoPreset(s: Plugin, path: string, name: string, tags: string[]) {
    const resolved = await this.resolvePlugin(s);
    const result = await this.engine.loadModoBassPreset({ plugin: resolved, path: resolve(path) });
    const preset: Preset = { id: randomUUID(), name, tags, plugin_id: s.plugin_id, plugin_version: resolved.plugin_version, state_base64: result.state_base64 };
    await locked(join(this.paths.catalog,'temp','catalog.lock'), async () => {
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
  async importKontaktPreset(s: Plugin, path: string, name: string, tags: string[], probePitch = 60) {
    const resolved = await this.resolvePlugin(s);
    if (process.platform !== 'win32' || s.plugin_id !== 'VST3:Native Instruments:Kontakt 8:f852a294' || resolved.plugin_version !== '8.13.0')
      throw new Error('Kontakt import is verified only for Native Instruments Kontakt 8 VST3 8.13.0 on Windows');
    const result = await this.engine.loadKontaktPreset({ plugin: resolved, path: resolve(path), probe_pitch: probePitch }, { timeout: 180000 });
    const preset: Preset = { id: randomUUID(), name, tags, plugin_id: s.plugin_id, plugin_version: resolved.plugin_version, state_base64: result.state_base64 };
    await locked(join(this.paths.catalog,'temp','catalog.lock'), async () => {
      const c = await this.catalog(); c.presets.push(preset); await atomicJson(this.catalogPath, c);
    });
    const { state_base64, ...metadata } = preset;
    return { ...metadata, adapter: result.adapter, format: result.format, loaded_probe_peak: result.loaded_probe_peak, restored_probe_peak: result.restored_probe_peak };
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
  async apply(args: { project_id: string; base_revision: number; request_id: string; operations: any[];summary?:string }) {
    return this.change(args.project_id,args.base_revision,args.request_id,args,async p=>{
      for(const op of args.operations){
        const choice=op.op==='add_track'?op.track.instrument:op.op==='set_track'?op.changes.instrument:undefined;
        const selectedName=choice?.kind==='plugin'?(await this.catalog()).plugins.find(x=>x.plugin_id===choice.plugin_id)?.name:'';
        if(p.instrument_policy==='plugin_first'&&(isBasicInstrument(choice)||isBasicInstrument({kind:'plugin',plugin_id:selectedName??''})))throw new Error('Basic MIDI/builtin instruments require explicit instrument_policy=allow_basic at project creation.');
      }
      return applyDocumentOperations(p,args.operations);
    });
  }
  private async freezeDocument(next:ReturnType<typeof parseDocument>,before:ReturnType<typeof parseDocument>,workDir?:string) {
    if ('kind' in next && next.kind === 'mastering') {
      const old = 'kind' in before && before.kind === 'mastering' ? before.mastering.songs : [];
      for(const song of next.mastering.songs)for(const version of song.versions){
        const prior=old.find(s=>s.id===song.id)?.versions.find(v=>v.id===version.id);
        if(prior){if(JSON.stringify(prior)!==JSON.stringify(version))throw new Error('Mastering versions are immutable');continue;}
        version.created_revision=next.revision;
        const {asset}=await inputAsset(this.dir(next.id),version.source_asset_id);
        if(asset.sha256!==version.source_sha256)throw new Error('Mastering source hash mismatch');
        const graph=compileDocument(next,{song_id:song.id,version_id:version.id});
        await this.freezePlugins(graph,workDir);
        await this.resolveAudio(next.id,graph.tracks[0].instrument,graph.duration_frames);
        version.effects=graph.master_effects;
      }
    } else {
      const graph=compileDocument(next);
      await this.freezePlugins(graph,workDir);
      for(const t of graph.tracks)if(t.instrument.kind==='audio')await this.resolveAudio(next.id,t.instrument,graph.duration_frames??String(Math.round(graph.length_ticks*60*48000/(graph.bpm*960))));
      if('kind' in next && (next.kind==='composition'||next.kind==='separation')) next.composition=compositionFromGraph(graph).composition;
      else Object.assign(next,graph);
    }
    return parseDocument(next);
  }
  private async change(projectId:string,base:number,requestId:string,payload:any,mutate:(p:ReturnType<typeof parseDocument>)=>ReturnType<typeof parseDocument>|Promise<ReturnType<typeof parseDocument>>) {
    id.parse(requestId);
    return this.workspace.change({projectId,baseRevision:base,requestId,fingerprint:fingerprint(payload),summary:payload.summary,restoreRevision:payload.restore_revision},async(current,context)=>{
      let next=parseDocument(await mutate(structuredClone(current)));next.revision=base+1;
      return this.freezeDocument(next,current,context.workDirectory);
    });
  }

  async restore(args:{project_id:string;base_revision:number;request_id:string;revision:number}) {
    return this.change(args.project_id,args.base_revision,args.request_id,{...args,restore_revision:args.revision},async()=>{
      if(args.revision>args.base_revision)throw new Error('Cannot restore a future revision');
      return parseDocument({...await this.workspace.readRevision(args.project_id,args.revision),id:args.project_id});
    });
  }
  async addMasteringSong(args:{project_id:string;base_revision:number;request_id:string;song_id:string;name:string;asset_id:string;effects:Plugin[]}) {
    const {asset}=await inputAsset(this.dir(args.project_id),args.asset_id);
    const version={id:args.request_id,label:'Original',created_at:new Date().toISOString(),created_revision:args.base_revision+1,source_asset_id:asset.id,source_sha256:asset.sha256,clip:{kind:'audio' as const,asset_id:asset.id,start_frame:'0',timeline_frame:'0',fade_in_frames:'0',fade_out_frames:'0'},duration_frames:String(asset.audio!.frames),tail_seconds:0,input_gain_db:0,effects:args.effects};
    // Generated timestamp is created inside the mutation, not the retry fingerprint.
    return this.change(args.project_id,args.base_revision,args.request_id,args,p=>applyDocumentOperations(p,[{op:'add_song',song:{id:args.song_id,name:args.name,versions:[version],current_version_id:version.id,comparison:{a:{kind:'version',version_id:version.id},b:{kind:'version',version_id:version.id}}}}]));
  }
  async createMasteringVersion(args:{project_id:string;base_revision:number;request_id:string;song_id:string;parent_version_id:string;label:string;effects?:Plugin[];input_gain_db?:number}) {
    return this.change(args.project_id,args.base_revision,args.request_id,args,p=>{
      if(!('kind' in p)||p.kind!=='mastering')throw new Error('Not a mastering project');
      const song=p.mastering.songs.find(s=>s.id===args.song_id),parent=song?.versions.find(v=>v.id===args.parent_version_id);if(!parent)throw new Error('Unknown mastering parent version');
      const version={...structuredClone(parent),id:args.request_id,parent_version_id:parent.id,label:args.label,created_at:new Date().toISOString(),created_revision:args.base_revision+1,effects:args.effects??parent.effects,input_gain_db:args.input_gain_db??parent.input_gain_db};
      return applyDocumentOperations(p,[{op:'add_version',song_id:args.song_id,version},{op:'set_current_version',song_id:args.song_id,version_id:version.id}]);
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
        const result = await this.engine.render({ plan: audioPlan(renderProject), output: partial, tail_seconds: tail }, options);
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
  async startPlayback(args:{project_id:string;start_frame:string;tail_seconds?:number;loop:boolean;loop_start_frame:string;loop_end_frame:string;output_device?:string;monitor_gain_db?:number;revision?:number;song_id?:string;version_id?:string;comparison?:'a'|'b'}){
    if(args.monitor_gain_db!==undefined&&(!Number.isFinite(args.monitor_gain_db)||args.monitor_gain_db< -96||args.monitor_gain_db>0))throw new Error('Monitor gain_db must be between -96 and 0');
    if(this.playbackStarting)throw new Error('Playback is already starting');
    if(this.playback&&!['stopped','completed','failed','cancelled'].includes(this.playback.state))throw new Error(`Playback already active: ${this.playback.id}`);
    // Reserve before the first await so two callers cannot publish competing sessions.
    this.playbackStarting=true;
    try {
    const saved=args.revision===undefined?await this.readDocument(args.project_id):await this.workspace.readRevision(args.project_id,args.revision);
    const doc={...saved,id:args.project_id},kind=doc.schema_version===3?doc.kind:'composition';
    const selected=doc.schema_version===3&&doc.kind==='mastering'?resolveMasteringTarget(doc,args):undefined;
    const tail=args.tail_seconds??(selected?(selected.selection.kind==='source'?0:selected.version.tail_seconds):2);
    const target:Playback['target']=selected?{song_id:selected.song.id,version_id:selected.version.id,comparison:args.comparison,source_asset_id:selected.version.source_asset_id,selection:{...selected.selection,version_id:selected.version.id},tail_seconds:tail}:{tail_seconds:tail};
    const p=compileDocument(doc,args),resolved=await this.resolvedProject(p),id=randomUUID();
    const job=await newJob(this.dir(p.id),{kind:'playback',project_kind:kind,project_id:p.id,revision:p.revision,...target},id);
    await atomicJson(join(job.path,'snapshots','input.json'),p);
    const controller=new AbortController();let session:Playback={track_ids:new Set(p.tracks.map(t=>t.id)),bus_ids:new Set(p.buses.map(b=>b.id)),kind,target,id,project_id:p.id,revision:p.revision,state:'queued',owner_pid:process.pid,created_at:new Date().toISOString(),jobPath:job.path,controller,done:Promise.resolve()};
    const persist=()=>atomicJson(join(job.path,'status.json'),{id,kind:'playback',project_kind:kind,project_id:p.id,revision:p.revision,...target,state:session.state,owner_pid:process.pid,created_at:session.created_at,...(session.error?{error:session.error}:{})});
    await persist();this.playback=session;
    const done=(async()=>{
      try{await this.processing.run('playback',async()=>{
        session.state='starting';await persist();
        session.worker=await this.engine.startPlayback({plan:audioPlan(resolved),start_frame:args.start_frame,tail_seconds:tail,loop:args.loop,loop_start_frame:args.loop_start_frame,loop_end_frame:args.loop_end_frame,output_device:args.output_device??'',monitor_gain_db:args.monitor_gain_db??0},{signal:controller.signal,workDir:join(job.path,'work')});
        await session.worker.ready;session.state='playing';await persist();const result=await session.worker.done;session.state=result.state;await persist();
      },{id,signal:controller.signal});}
      catch(error){session.state=controller.signal.aborted?'cancelled':'failed';session.error=String(error);await persist();}
    })();
    session.done=done;void done.catch(()=>{});
    return {playback_id:id,project_id:p.id,revision:p.revision,state:session.state,mode:'live_project_graph',...target,start_frame:args.start_frame,rendered_file_created:false};
    } finally { this.playbackStarting=false; }
  }
  async playbackStatus(playbackId?:string){
    const session=this.playback;if(!session||playbackId&&session.id!==playbackId)throw new Error('Playback session not found');
    let native:any;try{native=await session.worker?.status();}catch(error:any){if(error.code!=='ENOENT')throw error;}
    return {playback_id:session.id,project_id:session.project_id,revision:session.revision,...session.target,state:native?.state??session.state,created_at:session.created_at,...(native??{}),...(['failed','cancelled','stopped'].includes(session.state)?{state:session.state}:{}),...(session.error?{error:session.error}:{})};
  }
  async controlPlayback(action:'pause'|'resume'|'seek'|'stop',frame?:string,playbackId?:string){
    const session=this.playback;if(!session||playbackId&&session.id!==playbackId)throw new Error('Playback session not found');
    if(['stopped','completed','failed','cancelled'].includes(session.state))return this.playbackStatus(playbackId);
    for(let i=0;!session.worker&&session.state==='starting'&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,10));
    if(action==='stop'&&!session.worker){session.controller.abort();await session.done;return this.playbackStatus(playbackId);}
    if(!session.worker)throw new Error('Playback is queued; stop it or wait until the audio device is ready');
    if(session.state==='starting')await session.worker.ready;
    await session.worker.control(action==='seek'?{action,frame:frame!}:{action});if(action==='pause')session.state='paused';if(action==='resume')session.state='playing';if(action==='stop')await session.done;
    return this.playbackStatus(playbackId);
  }
  async setPlaybackVolume(gainDb:number,playbackId?:string) {
    if(!Number.isFinite(gainDb)||gainDb< -96||gainDb>0)throw new Error('Monitor gain_db must be between -96 and 0');
    const session=this.playback;
    if(!session||playbackId&&session.id!==playbackId)throw new Error('Playback session not found');
    for(let i=0;!session.worker&&session.state==='starting'&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,10));
    if(session.state==='starting'&&session.worker)await session.worker.ready;
    if(!session.worker||!['playing','paused'].includes(session.state))throw new Error('Playback is not ready');
    if(!['playing','paused'].includes((await this.playbackStatus(playbackId)).state))throw new Error('Playback has ended');
    await session.worker.control({action:'set_volume',gain_db:gainDb});
    return this.playbackStatus(playbackId);
  }
  async setPlaybackMix(changes:Array<{track_id?:string;bus_id?:string;mute?:boolean;solo?:boolean;gain_db?:number;pan?:number}>,playbackId?:string) {
    const session=this.playback;
    if(!session||playbackId&&session.id!==playbackId)throw new Error('Playback session not found');
    if(!changes.length)throw new Error('Mix changes cannot be empty');
    for(let i=0;!session.worker&&session.state==='starting'&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,10));
    if(session.state==='starting'&&session.worker)await session.worker.ready;
    if(!session.worker||!['playing','paused'].includes(session.state))throw new Error('Playback is not ready');
    const status=await this.playbackStatus(playbackId);
    if(!['playing','paused'].includes(status.state))throw new Error('Playback has ended');
    for(const change of changes){
      if(Boolean(change.track_id)===Boolean(change.bus_id)||[change.mute,change.solo,change.gain_db,change.pan].every(v=>v===undefined))throw new Error('Invalid mix override');
      if(session.kind==='mastering'&&(change.bus_id!==undefined||change.gain_db===undefined||change.pan!==undefined||change.mute!==undefined||change.solo!==undefined))throw new Error('Mastering playback accepts only input gain_db for the selected song track; other mix controls require composition playback');
      if(change.gain_db!==undefined&&(!Number.isFinite(change.gain_db)||change.gain_db< -96||change.gain_db>12))throw new Error('Playback gain_db must be between -96 and 12');
      if(change.pan!==undefined&&(!Number.isFinite(change.pan)||change.pan< -1||change.pan>1))throw new Error('Playback pan must be between -1 and 1');
      if(change.mute!==undefined&&typeof change.mute!=='boolean'||change.solo!==undefined&&typeof change.solo!=='boolean')throw new Error('Mute and solo must be boolean');
      if(change.track_id&&!session.track_ids?.has(change.track_id))throw new Error('Unknown track in pinned playback');
      if(change.bus_id&&!session.bus_ids?.has(change.bus_id))throw new Error('Unknown return in pinned playback');
    }
    await session.worker.control({action:'set_mix',changes});
    return this.playbackStatus(playbackId);
  }
  async findJob(jobId:string) {
    const library=join(this.paths.catalog,'jobs',id.parse(jobId),'status.json');try{await readFile(library);return library;}catch(e:any){if(e.code!=='ENOENT')throw e;}
    let names:string[]=[];try{names=await readdir(this.paths.projects);}catch(e:any){if(e.code!=='ENOENT')throw e;}
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
  async close() { if(this.playback&&!['stopped','completed','failed','cancelled'].includes(this.playback.state)){if(this.playback.worker)await this.playback.worker.control({action:'stop'}).catch(()=>{});else this.playback.controller.abort();}this.processing.shutdown(); const pending = [...this.jobs.values()]; for (const j of pending) j.controller.abort(); await Promise.allSettled([...pending.map(j => j.done),...(this.playback?[this.playback.done]:[])]); await this.processing.idle(); await this.engine.close(); }
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
    await this.workspace.create(parseDocument(p));
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
  async listProjects() { return this.workspace.list(); }
}
