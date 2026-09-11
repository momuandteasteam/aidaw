import { ContentCatalog, contentDefinitions } from './content.js';
import { inspectMidi, importMidi } from './midi-import.js';
import { measure } from './measure.js';
import { relink, cleanWork } from './maintenance.js';
import { batchRender, startBatch, batchTask } from './batch.js';
import { publish, publishBatch, recover, tags } from './delivery.js';
import { exportBundle, importBundle } from './package.js';
import { ingest, manifest } from './assets.js';
import { Knowledge, knowledgeDefinitions } from './knowledge.js';
import { z } from 'zod';
import { frame, id, instrument, operation, plugin, project } from './schema.js';
import { Service } from './service.js';
import { PluginInventory } from './plugin-inventory.js';

const projectId = { project_id: id };
const revision = z.number().int().nonnegative();
const changes = { ...projectId, base_revision: revision, request_id: id };
const fmt = z.enum(['VST3', 'AudioUnit']);
export const definitions = {
  delivery_inspect:{description:'Read the already published delivery manifest and server file paths without rendering or conversion.',schema:z.object({project_id:id}).strict()},
  queue_status:{description:'Show the single server processing lane and FIFO waiting operations. Connections and job reads stay responsive.',schema:z.object({}).strict()},
  playback_devices:{description:'List audio output devices available on the AIDAW server. Live playback is heard on the server machine.',schema:z.object({}).strict()},
  playback_start:{description:'Play the current project revision directly through its instruments, track FX, sends, returns and master chain without rendering a file. Playback occupies the single audio-processing lane.',schema:z.object({...projectId,start_frame:frame.default('0'),tail_seconds:z.number().min(0).max(30).default(2),loop:z.boolean().default(false),loop_start_frame:frame.default('0'),loop_end_frame:frame.default('0'),output_device:z.string().min(1).max(500).optional()}).strict()},
  playback_status:{description:'Read live playback position, revision, device, processing latency and xrun count.',schema:z.object({playback_id:id.optional()}).strict()},
  playback_pause:{description:'Pause the active player without unloading its plug-ins.',schema:z.object({playback_id:id.optional()}).strict()},
  playback_resume:{description:'Resume the active player.',schema:z.object({playback_id:id.optional()}).strict()},
  playback_seek:{description:'Move live playback to an exact 48kHz project frame. Sustained MIDI notes are chased from the new position.',schema:z.object({playback_id:id.optional(),frame}).strict()},
  playback_stop:{description:'Stop live playback and release the audio device and plug-ins.',schema:z.object({playback_id:id.optional()}).strict()},
  ...knowledgeDefinitions,
  ...contentDefinitions,
  midi_inspect:{description:'Parse SMF 0/1 notes and timing. Report unsupported controllers/program changes; variable tempo is rejected.',schema:z.object({path:z.string().min(1)}).strict()},
  midi_import:{description:'Import selected MIDI parts with explicitly assigned instruments in one revision. Unsupported events require explicit notes_only acknowledgment.',schema:z.object({...changes,path:z.string().min(1),adopt_tempo:z.boolean().default(false),notes_only:z.boolean().default(false),tracks:z.array(z.object({track_index:z.number().int().nonnegative(),track_id:id,name:z.string().min(1).max(200).optional(),instrument}).strict()).min(1).max(64)}).strict()},
  mixer_inspect:{description:'Read track strips, pre/post sends, FX return strips and master chain. No GUI is required.',schema:z.object(projectId).strict()},

  audio_measure:{description:'Measure source integrated LUFS, true peak and loudness range with FFmpeg. Does not normalize or edit the source, or prescribe -14 LUFS.',schema:z.object({path:z.string().min(1)}).strict()},
  batch_delivery_publish:{description:'Publish all completed batch songs together as WAV/optional tagged MP3/report/ZIP using one recoverable release manifest.',schema:z.object({...projectId,job_id:id,tags:z.record(id,tags).default({}),mp3:z.boolean().default(true)}).strict()},
  asset_relink:{description:'Restore a missing/corrupt collected asset from a file with the exact original hash. Keeps source/reference role unchanged.',schema:z.object({...projectId,asset_id:z.string().min(1),path:z.string().min(1)}).strict()},
  project_cleanup:{description:'List or remove only completed job work files. Never removes artifacts, source assets, frozen audio or failed jobs.',schema:z.object({...projectId,dry_run:z.boolean().default(true)}).strict()},
  export_notation_midi:{description:'Export notation pitches without keyswitch notes, separately from plugin performance MIDI.',schema:z.object(projectId).strict()},
  batch_render:{description:'Master multiple source assets in ONE project job. No implicit cut; failed tasks can be resumed without repeating completed files.',schema:z.object({...projectId,tasks:z.array(batchTask).min(1).max(100),wait:z.boolean().default(false)}).strict()},
  batch_render_resume:{description:'Resume a source-audio batch using its pinned snapshot and task settings.',schema:z.object({...projectId,job_id:id,wait:z.boolean().default(false)}).strict()},
  delivery_publish:{description:'Validate and publish a current render with stems, optional tagged MP3, MIDI, report and delivery ZIP. Journals updates for rollback. Does not certify listening quality.',schema:z.object({...projectId,job_id:id,tags,mp3:z.boolean().default(true),artwork_asset_id:z.string().optional()}).strict()},
  delivery_recover:{description:'Recover an interrupted output publication from its journal.',schema:z.object(projectId).strict()},
  bundle_export:{description:'Collect current project, hashed assets, and frozen audio from a successful current-revision render. Excludes jobs, temp and existing ZIPs.',schema:z.object({...projectId,job_id:id}).strict()},
  bundle_import:{description:'Import a validated portable package under a new project ID; never substitute missing plugins. Includes frozen playback.',schema:z.object({...projectId,path:z.string().min(1)}).strict()},
  project_validate:{description:'Check assets and plugin dependencies; return frozen playback when available. Does not claim live plugin compatibility.',schema:z.object(projectId).strict()},
  asset_import:{description:'Copy an immutable source/reference/artwork into the project, hash and analyze it. Reference audio is forbidden as render input.',schema:z.object({...projectId,path:z.string().min(1),role:z.enum(['source','reference','artwork'])}).strict()},
  asset_list:{description:'List project assets and provenance.',schema:z.object(projectId).strict()},
  system_capabilities: { description: 'Report the native engine platform and supported features. AU is macOS only; VST3 is shared with Windows.', schema: z.object({}).strict() },
  catalog_discover: { description: 'List plugin candidate locations without loading them. Scan individual candidates next.', schema: z.object({ format: fmt, search_path: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(25) }).strict() },
  catalog_inventory: { description: 'Discover every candidate in the requested formats, scan each in isolation, index exposed parameters/programs, and checkpoint one resumable job. Failed plugins do not stop the remaining inventory.', schema:z.object({formats:z.array(fmt).min(1).max(2).default(['VST3']),max_seconds:z.number().int().min(1).max(3600).default(300)}).strict() },
  catalog_inventory_resume: { description:'Resume pending candidates in an existing plugin inventory job.',schema:z.object({job_id:id,max_seconds:z.number().int().min(1).max(3600).default(300)}).strict() },
  catalog_inventory_status: { description:'Read plugin inventory coverage and per-candidate failures without running plugin code.',schema:z.object({job_id:id}).strict() },
  catalog_portable_export: { description:'Export a sanitized metadata catalog without installation paths, plugin state, binaries or licenses.',schema:z.object({job_id:id.optional()}).strict() },
  catalog_reference_search: { description:'Search the source-controlled observed metadata catalog. Results describe known plugin parameters/programs but do not prove installation on this server.',schema:z.object({query:z.string().max(500).default(''),limit:z.number().int().min(1).max(50).default(10)}).strict() },
  catalog_scan: { description: 'Scan ONE candidate in an isolated worker and register its plugins. Scan success is not render compatibility certification.', schema: z.object({ format: fmt, location: z.string().min(1) }).strict() },
  catalog_search: { description: 'Find installed plugins and saved presets. Basic GM/builtin candidates are excluded unless include_basic is explicit. Tags on saved presets are user-provided.', schema: z.object({ query: z.string().default(''), limit: z.number().int().min(1).max(50).default(10), instrument_only: z.boolean().optional(), include_basic:z.boolean().default(false) }).strict() },
  plugin_inspect: { description: 'Load a registered plugin and inspect its normalized parameter IDs and programs. No GUI is opened.', schema: z.object({ plugin, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(50) }).strict() },
  plugin_preset_save: { description: 'Apply a program/normalized parameters and save a named state preset. Returns preset ID usable in a track instrument/effect.', schema: z.object({ plugin, name: z.string().min(1).max(200), tags: z.array(z.string().max(80)).max(30).default([]) }).strict() },
  modo_bass_preset_import: { description: 'Import a local .mb2 musical preset using the version-checked MODO BASS 2 VST3 2.0.5 adapter. Returns a reusable preset ID after state readback verification.', schema: z.object({ plugin, path: z.string().min(1), name: z.string().min(1).max(200), tags: z.array(z.string().max(80)).max(30).default([]) }).strict() },
  massive_x_preset_import: { description: 'Import a local NKS preset for Massive X VST3 1.7.1 (R0), validating its product ID and capturing plugin state. Requires an installed and initialized plugin; does not bundle its content.', schema: z.object({ plugin, path: z.string().min(1), name: z.string().min(1).max(200), tags: z.array(z.string().max(80)).max(30).default([]) }).strict() },
  kontakt_preset_import: { description: 'Load a discovered local .nki or .nksn into Native Instruments Kontakt 8 VST3 on Windows, verify audible output before and after saved-state restoration, and return a reusable preset ID. Set probe_pitch to a playable MIDI note for limited-range instruments. Does not bundle or license the sample library.', schema: z.object({ plugin, path: z.string().min(1), name: z.string().min(1).max(200), tags: z.array(z.string().max(80)).max(30).default([]), probe_pitch: z.number().int().min(0).max(127).default(60) }).strict() },
  project_list: { description: 'List local projects.', schema: z.object({}).strict() },
  project_create: { description: 'Create an editable project. Timing uses integer ticks, 960 ticks per quarter note. No implicit music generation.', schema: z.object({ ...projectId, name: z.string().min(1).max(200), duration_frames:frame.optional(), instrument_policy:z.enum(['plugin_first','allow_basic']).default('plugin_first'), bpm: z.number().min(20).max(300).default(120), length_ticks: z.number().int().positive().max(10000000), meter: z.tuple([z.number().int().min(1).max(32), z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)])]).default([4, 4]) }).strict() },
  project_inspect: { description: 'Read current revision, sections, harmony and tracks. Notes are omitted by default; request them for precise edits.', schema: z.object({ ...projectId, include_notes: z.boolean().default(false) }).strict() },
  project_apply: { description: 'Atomically apply concrete musical edits at base_revision. Use a unique request_id; identical retries are safe. Captures plugin state before committing.', schema: z.object({ ...changes, operations: z.array(operation).min(1).max(256) }).strict() },
  project_restore: { description: 'Restore a previous saved revision as a NEW revision, retaining history.', schema: z.object({ ...changes, revision }).strict() },
  render_start: { description: 'Start offline WAV rendering of a fixed revision. Poll job_status; a succeeded job provides an absolute output path. track_id exports a stem with track inserts and without master effects.', schema: z.object({ ...projectId, tail_seconds: z.number().min(0).max(30).default(1), track_id: id.optional(), request_id:id.optional(),rerender_tracks:z.array(id).max(64).default([]) }).strict() },
  job_status: { description: 'Read render progress, errors, finished output and audio measurements.', schema: z.object({ job_id: id }).strict() },
  job_cancel: { description: 'Cancel a render owned by this MCP service. Partial WAV files are discarded.', schema: z.object({ job_id: id }).strict() },
  audio_analyze: { description: 'Measure a local mono/stereo WAV: sample peak, RMS, silence and clipping. This does not measure LUFS or true peak.', schema: z.object({ path: z.string().min(1) }).strict() },
  export_midi: { description: 'Write a Standard MIDI File type 1 with notes, tempo and meter. Plugin sounds/effects remain in the project, not MIDI.', schema: z.object(projectId).strict() },
  export_project: { description: 'Export a portable project JSON with concrete notes and saved plugin states. Does not bundle plugin binaries or sample libraries.', schema: z.object(projectId).strict() },
  project_import: { description: 'Import exported project data under a new project ID. Plugins must be rescanned on the destination machine before rendering.', schema: z.object({ ...projectId, project }).strict() },
} as const;
export type ToolName = keyof typeof definitions;
export async function call(service: Service, name: string, input: unknown): Promise<any> {
  if (!Object.hasOwn(definitions, name)) throw new Error(`Unknown tool: ${name}`);
  const a: any = definitions[name as ToolName].schema.parse(input);
  const immediate=new Set(['delivery_inspect','queue_status','playback_start','playback_status','playback_pause','playback_resume','playback_seek','playback_stop','job_status','job_cancel','project_list','project_inspect','mixer_inspect','asset_list','catalog_search','catalog_inventory_status','catalog_portable_export','catalog_reference_search','content_search','sound_search','effect_search','knowledge_search','system_capabilities','render_start','batch_render','batch_render_resume']);
  if(!immediate.has(name))return service.processing.run(name,()=>dispatch(service,name,a));
  return dispatch(service,name,a);
}
async function dispatch(service:Service,name:string,a:any):Promise<any>{
  switch(name as ToolName){
    case 'queue_status':return service.processing.status();
    case 'playback_devices':return service.engine.call({command:'playback_devices'});
    case 'playback_start':return service.startPlayback(a);
    case 'playback_status':return service.playbackStatus(a.playback_id);
    case 'playback_pause':return service.controlPlayback('pause',undefined,a.playback_id);
    case 'playback_resume':return service.controlPlayback('resume',undefined,a.playback_id);
    case 'playback_seek':return service.controlPlayback('seek',a.frame,a.playback_id);
    case 'playback_stop':return service.controlPlayback('stop',undefined,a.playback_id);
    case 'delivery_inspect':{const {readJson}=await import('./storage.js');const {join}=await import('node:path');const {portablePath}=await import('./assets.js');try{const m=await readJson(join(service.dir(a.project_id),'outputs','manifest.json'));return {...m,available:true,files:m.files.map((f:any)=>({...f,server_path:join(service.dir(a.project_id),'outputs',portablePath(f.path))}))};}catch(e:any){if(e.code==='ENOENT')return {available:false,project_id:a.project_id};throw e;}}
    case 'content_discover_roots': return new ContentCatalog(service).discover();
    case 'content_register_root': return new ContentCatalog(service).register(a.name,a.path,a.family);
    case 'content_index': return new ContentCatalog(service).index(a.root_ids,a.max_files,a.max_seconds);
    case 'content_search': return new ContentCatalog(service).search(a.query,a.family,a.limit,a.offset);
    case 'content_bind_preset': return new ContentCatalog(service).bind(a.content_id,a.preset_id,a.probe_id,a.description);
    case 'midi_inspect': return inspectMidi(a.path);
    case 'midi_import': return importMidi(service,a);
    case 'mixer_inspect':{const p=await service.inspect(a.project_id,false);const {readJson}=await import('./storage.js');const {join}=await import('node:path');let meters;try{const last=await readJson(join(service.dir(a.project_id),'state','mixer.json'));meters={revision:last.revision,stale:last.revision!==p.revision,tracks:last.tracks.map((t:any)=>({id:t.id,meter:t.meter})),returns:last.returns.map((b:any)=>({id:b.id,meter:b.meter}))};}catch(e:any){if(e.code!=='ENOENT')throw e;}return {revision:p.revision,tracks:p.tracks.map(({notes,...t}:any)=>t),returns:p.buses,master_effects:p.master_effects,meters,meters_mode:'last_offline_render'};}
    case 'audio_measure': return measure(a.path);
    case 'batch_delivery_publish': return publishBatch(service,a.project_id,a.job_id,a.tags,a.mp3);
    case 'asset_relink': return relink(service,a.project_id,a.asset_id,a.path);
    case 'project_cleanup': return cleanWork(service,a.project_id,a.dry_run);
    case 'export_notation_midi': return service.exportNotationMidi(a.project_id);
    case 'batch_render':{const j=await startBatch(service,a.project_id,a.tasks);return a.wait?service.wait(j.job_id):j;}
    case 'batch_render_resume':{const j=await startBatch(service,a.project_id,[],a.job_id);return a.wait?service.wait(j.job_id):j;}
    case 'delivery_publish': return publish(service,a.project_id,a.job_id,a.tags,a.mp3,a.artwork_asset_id);
    case 'delivery_recover': return service.recoverDelivery(a.project_id);
    case 'bundle_export': return exportBundle(service,a.project_id,a.job_id);
    case 'bundle_import': return importBundle(service,a.path,a.project_id);
    case 'project_validate': return service.validate(a.project_id);
    case 'asset_import': return ingest(service,a.project_id,a.path,a.role);
    case 'asset_list': return manifest(service.dir(a.project_id));
    case 'plugin_verify': return new Knowledge(service).verify(a.plugin);
    case 'parameter_annotate': return new Knowledge(service).annotate(a.snapshot_id,a.parameter_id,a.meaning,a.evidence);
    case 'sound_search': return new Knowledge(service).findSound(a.query,'sound',a.limit);
    case 'effect_search': return new Knowledge(service).findSound(a.query,'effect',a.limit);
    case 'catalog_index': return new Knowledge(service).catalogIndex();
    case 'instrument_probe': return new Knowledge(service).batch(a.plugins,a.pitches,a.velocity,a.bpm,a.max_seconds);
    case 'instrument_probe_resume': return new Knowledge(service).batch([],[],100,120,60,a.job_id);
    case 'effect_probe': return new Knowledge(service).effectProbe(a.plugin,a.path);
    case 'sound_audition_in_context': return new Knowledge(service).context(a.project_id,a.track_id,a.plugin);
    case 'catalog_feedback': return new Knowledge(service).feedback(a.record_id,a.reviewer,a.comment,a.preference);
    case 'effect_index': return new Knowledge(service).index(a.plugin);
    case 'sound_probe': return new Knowledge(service).probe(a.plugin,a.pitches,a.velocity,a.bpm);
    case 'sound_assess': return new Knowledge(service).assess(a);
    case 'knowledge_search': return new Knowledge(service).search(a.query,a.kind,a.limit);
    case 'system_capabilities': return { ...await service.engine.call({ command: 'capabilities' }), project_schema: 2, ppq: 960, instrument_selection_policy:'plugin_first; inspect content libraries and audition before choosing. Basic sounds only with explicit allow_basic.', builtin_sounds: [],
      limitations: ['fixed tempo and 48kHz stereo for offline rendering and live playback', 'live playback uses a pinned revision; stop and restart after project edits', 'static latency only; changes during processing require restart', 'instrument/insert/master automation at 64-sample control intervals; no CC/sidechains yet', 'LUFS/true peak measurement requires FFmpeg; no automatic listening judgment', 'one-level pre/post-fader sends; bus-to-bus routing unsupported', 'bundle import capped at 512 MiB compressed / 1 GiB expanded', 'audio input fixed at 48 kHz; explicit SRC required for other rates'] };
    case 'catalog_discover': { const result = await service.discover(a.format, a.search_path); return { candidates: result.candidates.slice(a.offset, a.offset + a.limit), total: result.candidates.length }; }
    case 'catalog_inventory': return new PluginInventory(service).start(a.formats,a.max_seconds);
    case 'catalog_inventory_resume': return new PluginInventory(service).start([],a.max_seconds,a.job_id);
    case 'catalog_inventory_status': return new PluginInventory(service).status(a.job_id);
    case 'catalog_portable_export': return {output:await new PluginInventory(service).exportPortable(a.job_id)};
    case 'catalog_reference_search': return new PluginInventory(service).searchReference(a.query,a.limit);
    case 'catalog_scan': return service.scan(a.format, a.location);
    case 'catalog_search': return service.search(a.query, a.limit, a.instrument_only, a.include_basic);
    case 'plugin_inspect': { const result = await service.inspectPlugin(a.plugin); return { ...result, parameters: result.parameters.slice(a.offset, a.offset + a.limit), parameter_count: result.parameters.length }; }
    case 'plugin_preset_save': return service.savePreset(a.plugin, a.name, a.tags);
    case 'modo_bass_preset_import': return service.importModoPreset(a.plugin, a.path, a.name, a.tags);
    case 'massive_x_preset_import': return service.importMassiveXPreset(a.plugin, a.path, a.name, a.tags);
    case 'kontakt_preset_import': return service.importKontaktPreset(a.plugin, a.path, a.name, a.tags, a.probe_pitch);
    case 'project_list': return service.listProjects();
    case 'project_create': return service.create(a);
    case 'project_inspect': return service.inspect(a.project_id, a.include_notes);
    case 'project_apply': return service.apply(a);
    case 'project_restore': return service.restore(a);
    case 'render_start': return service.startRenderRequest(a.project_id, a.tail_seconds, a.track_id,a.request_id,a.rerender_tracks);
    case 'job_status': return service.jobStatus(a.job_id);
    case 'job_cancel': return service.cancel(a.job_id);
    case 'audio_analyze': return service.engine.call({ command: 'analyze', path: a.path });
    case 'export_midi': return service.exportMidi(a.project_id);
    case 'export_project': return service.exportProject(a.project_id);
    case 'project_import': return service.importProject(a.project, a.project_id);
  }
}
