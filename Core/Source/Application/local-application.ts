import {projectArtwork} from '../Adapters/node/media/artwork.js';
import {startSeparation,exportSeparation,separationRequest,separationExportRequest} from './separation.js';
import { applicationContract,type ApplicationPort } from '../Contracts/application-contract.js';
import { domainOperation, parseDocument } from '../Domain/domain.js';
import { waveformInput, projectWaveform } from '../Adapters/node/media/waveform.js';
import { activeContextInput } from '../Adapters/node/runtime/active-context.js';
import { saveProject } from '../Adapters/node/workspace/package.js';
import { exportRequest, startExport } from './export.js';
import { revisionSnapshot } from '../Adapters/node/workspace/layout.js';
import { ContentCatalog, contentDefinitions } from '../Adapters/node/catalog/content.js';
import { inspectMidi, importMidi } from '../Adapters/node/media/midi-import.js';
import { measure } from './measure.js';
import { relink, cleanWork } from './maintenance.js';
import { batchRender, startBatch, batchTask } from './batch.js';
import { publish, publishBatch, recover, tags } from './delivery.js';
import { exportBundle, importBundle } from '../Adapters/node/workspace/package.js';
import { ingest, manifest } from '../Adapters/node/workspace/assets.js';
import { Knowledge, knowledgeDefinitions } from './knowledge.js';
import { z } from 'zod';
import { frame, id, instrument, operation, plugin, project } from '../Domain/schema.js';
import { Service } from './service.js';
import { PluginInventory } from '../Adapters/node/catalog/plugin-inventory.js';

const projectId = { project_id: id };
const revision = z.number().int().nonnegative();
const changes = { ...projectId, base_revision: revision, request_id: id };
const fmt = z.enum(['VST3', 'AudioUnit']);
export const definitions = {
  project_artwork:{description:'Read the latest collected project artwork as a JPEG/PNG data URL, or null when unavailable. Does not render audio.',schema:z.object(projectId).strict()},
  project_waveform:{description:'Read measured peak bins from existing audio only, without rendering or loading plugins. Composition requires a completed mix at the selected revision. Mastering shows the selected source clip, explicitly labelled source (not processed FX output).',schema:waveformInput},
  active_context_get:{description:'Read the project, song and audition version currently selected in the AIDAW GUI, shared across processes using this AIDAW_HOME. Call before every editing instruction, then read project_document for the current base_revision. unavailable means do not guess the target. Audition selection is separate from the authored revision.',schema:z.object({}).strict()},
  active_context_set:{description:'Replace the shared GUI project/song/audition selection without changing project history. Omitted optional fields clear previous choices; project_id:null clears the selection. Validates that project, revision, song and version exist. This does not start playback.',schema:activeContextInput},
  project_document:{description:'Read the authoritative mode-specific document, optionally at an immutable historical revision. Composition contains tracks/mixer; mastering contains songs and versions.',schema:z.object({...projectId,revision:z.number().int().nonnegative().optional()}).strict()},
  project_history:{description:'List saved differential revisions without changing the current document.',schema:z.object({...projectId,offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(200).default(50)}).strict()},
  project_save:{description:'Save an editable name.aidaw.zip archive with history and sources for either project kind. No render required. The editable workspace stays in projects/<id>/; internal kind determines mode.',schema:z.object({...projectId,include_audio:z.boolean().default(false)}).strict()},
  project_open:{description:'Restore an .aidaw.zip archive (including legacy .aidaw/.zip names) under a new project ID, preserving history. Internal document kind determines mode.',schema:z.object({...projectId,path:z.string().min(1)}).strict()},
  export_start:{description:'Export a fixed composition or mastering song/album to WAV24, MP3 320kbps or FLAC, all 48kHz stereo. Poll job_status for files and failures.',schema:exportRequest},
  mastering_add_song:{description:'Add a source asset as one album song with its own immutable initial effect-chain version.',schema:z.object({...changes,song_id:id,name:z.string().min(1).max(200),asset_id:z.string().min(1),effects:z.array(plugin).default([])}).strict()},
  mastering_create_version:{description:'Create a new immutable song processing version from a prior version. Omitted chain/gain inherit from that parent; A/B assignments remain independent.',schema:z.object({...changes,song_id:id,parent_version_id:id,label:z.string().min(1).max(200),effects:z.array(plugin).optional(),input_gain_db:z.number().min(-96).max(12).optional()}).strict()},
  playback_set_volume:{description:'Set temporary monitor output volume after the master effects. Audio callback acknowledged; never changes saved projects or exports.',schema:z.object({playback_id:id.optional(),gain_db:z.number().min(-96).max(0)}).strict()},
  playback_set_mix:{description:'Apply temporary composition track/return gain, pan, mute and solo overrides, acknowledged by the audio callback. Mastering accepts gain_db only on its selected song track as input gain. Saved revisions remain unchanged.',schema:z.object({playback_id:id.optional(),changes:z.array(z.object({track_id:id.optional(),bus_id:id.optional(),mute:z.boolean().optional(),solo:z.boolean().optional(),gain_db:z.number().min(-96).max(12).optional(),pan:z.number().min(-1).max(1).optional()}).strict().refine(v=>Boolean(v.track_id)!==Boolean(v.bus_id),'Specify one track or return').refine(v=>[v.mute,v.solo,v.gain_db,v.pan].some(x=>x!==undefined),'Specify gain_db, pan, mute or solo')).min(1)}).strict()},
  delivery_inspect:{description:'Read the already published delivery manifest and server file paths without rendering or conversion.',schema:z.object({project_id:id}).strict()},
  queue_status:{description:'Show the single server processing lane and FIFO waiting operations. Connections and job reads stay responsive.',schema:z.object({}).strict()},
  playback_devices:{description:'List audio output devices available on the AIDAW server. Live playback is heard on the server machine.',schema:z.object({}).strict()},
  playback_start:{description:'Play the current project revision directly through its instruments, track FX, sends, returns and master chain without rendering a file. Playback occupies the single audio-processing lane.',schema:z.object({...projectId,start_frame:frame.default('0'),tail_seconds:z.number().min(0).max(30).optional(),loop:z.boolean().default(false),loop_start_frame:frame.default('0'),loop_end_frame:frame.default('0'),output_device:z.string().min(1).max(500).optional(),monitor_gain_db:z.number().min(-96).max(0).default(0),revision:z.number().int().nonnegative().optional(),song_id:id.optional(),version_id:id.optional(),comparison:z.enum(['a','b']).optional()}).strict()},
  playback_status:{description:'Read live playback position, revision, device, processing latency and xrun count.',schema:z.object({playback_id:id.optional()}).strict()},
  playback_pause:{description:'Pause the active player without unloading its plug-ins.',schema:z.object({playback_id:id.optional()}).strict()},
  playback_resume:{description:'Resume the active player.',schema:z.object({playback_id:id.optional()}).strict()},
  playback_seek:{description:'Move live playback to an exact 48kHz project frame. Sustained MIDI notes are chased from the new position.',schema:z.object({playback_id:id.optional(),frame}).strict()},
  playback_stop:{description:'Stop live playback and release the audio device and plug-ins.',schema:z.object({playback_id:id.optional()}).strict()},
  ...knowledgeDefinitions,
  ...contentDefinitions,
  midi_inspect:{description:'Parse SMF 0/1 notes and timing. Report unsupported controllers/program changes; variable tempo is rejected.',schema:z.object({path:z.string().min(1)}).strict()},
  midi_import:{description:'Import selected MIDI parts with explicitly assigned instruments in one revision. Unsupported events require explicit notes_only acknowledgment.',schema:z.object({...changes,path:z.string().min(1),adopt_tempo:z.boolean().default(false),notes_only:z.boolean().default(false),tracks:z.array(z.object({track_index:z.number().int().nonnegative(),track_id:id,name:z.string().min(1).max(200).optional(),instrument}).strict()).min(1)}).strict()},
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
  project_validate:{description:'Check composition assets and plugin dependencies; return frozen playback when available. Does not claim live plugin compatibility. For mastering, read project_document and select a song/version for playback or export; edits validate their source and chain.',schema:z.object(projectId).strict()},
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
  separation_start:{description:'Start source separation on a separation project. Returns a queued job; poll job_status. Uses source_asset_id and atomically replaces stems only at base_revision.',schema:separationRequest},
  separation_export:{description:'Export all separated WAV stems as ZIP, or a mix of a fixed revision reflecting saved mute/solo/gain. Returns job ID; poll job_status for downloadable files.',schema:separationExportRequest},
  project_create: { description: 'Create an editable project. Timing uses integer ticks, 960 ticks per quarter note. No implicit music generation.', schema: z.object({ ...projectId, name: z.string().min(1).max(200), kind:z.enum(['composition','mastering','separation']).optional(), duration_frames:frame.optional(), instrument_policy:z.enum(['plugin_first','allow_basic']).default('plugin_first'), bpm: z.number().min(20).max(300).default(120), length_ticks: z.number().int().positive().max(10000000).default(3840), meter: z.tuple([z.number().int().min(1).max(32), z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)])]).default([4, 4]) }).strict() },
  project_inspect: { description: 'Inspect a composition render graph: revision, sections, harmony and tracks. Notes are omitted by default. Use project_document for the authoritative mode-specific composition or mastering document.', schema: z.object({ ...projectId, include_notes: z.boolean().default(false) }).strict() },
  project_apply: { description: 'Atomically apply concrete musical edits at base_revision. Use a unique request_id; identical retries are safe. Captures plugin state before committing.', schema: z.object({ ...changes, operations: z.array(domainOperation).min(1).max(256),summary:z.string().max(1000).optional() }).strict() },
  project_restore: { description: 'Restore a previous saved revision as a NEW revision, retaining history.', schema: z.object({ ...changes, revision }).strict() },
  render_start: { description: 'Start offline WAV rendering of a fixed revision. Poll job_status; a succeeded job provides an absolute output path. track_id exports a stem with track inserts and without master effects.', schema: z.object({ ...projectId, tail_seconds: z.number().min(0).max(30).default(1), track_id: id.optional(), request_id:id.optional(),rerender_tracks:z.array(id).default([]) }).strict() },
  job_status: { description: 'Read render progress, errors, finished output and audio measurements.', schema: z.object({ job_id: id }).strict() },
  job_cancel: { description: 'Cancel a render owned by this MCP service. Partial WAV files are discarded.', schema: z.object({ job_id: id }).strict() },
  audio_analyze: { description: 'Measure a local mono/stereo WAV: sample peak, RMS, silence and clipping. This does not measure LUFS or true peak.', schema: z.object({ path: z.string().min(1) }).strict() },
  export_midi: { description: 'Write a Standard MIDI File type 1 with notes, tempo and meter. Plugin sounds/effects remain in the project, not MIDI.', schema: z.object(projectId).strict() },
  export_project: { description: 'Legacy composition JSON export with concrete notes and saved plugin states. Use project_save for an editable .aidaw.zip archive with assets and history in either mode, or project_document to read its JSON.', schema: z.object(projectId).strict() },
  project_import: { description: 'Import exported project data under a new project ID. Plugins must be rescanned on the destination machine before rendering.', schema: z.object({ ...projectId, project }).strict() },
} as const;
export type ToolName = keyof typeof definitions;
async function invokeLocal(service: Service, name: string, input: unknown): Promise<any> {
  if (!Object.hasOwn(definitions, name)) throw new Error(`Unknown tool: ${name}`);
  const a: any = definitions[name as ToolName].schema.parse(input);
  const immediate=new Set(['project_artwork','separation_start','separation_export','project_waveform','active_context_get','active_context_set','project_document','project_history','project_save','export_start','playback_set_mix','playback_set_volume','playback_devices','delivery_inspect','queue_status','playback_start','playback_status','playback_pause','playback_resume','playback_seek','playback_stop','job_status','job_cancel','project_list','project_inspect','mixer_inspect','asset_list','catalog_search','catalog_inventory_status','catalog_portable_export','catalog_reference_search','content_search','sound_search','effect_search','knowledge_search','system_capabilities','render_start','batch_render','batch_render_resume']);
  if(!immediate.has(name))return service.processing.run(name,()=>dispatch(service,name,a));
  return dispatch(service,name,a);
}
async function dispatch(service:Service,name:string,a:any):Promise<any>{
  switch(name as ToolName){
    case 'project_artwork':return projectArtwork(service,a.project_id);
    case 'project_waveform':return projectWaveform(service,a);
    case 'active_context_get':return service.activeContext();
    case 'active_context_set':return service.selectActiveContext(a);
    case 'queue_status':return service.processing.status();
    case 'playback_devices':return service.engine.listAudioOutputs();
    case 'playback_start':return service.startPlayback(a);
    case 'playback_status':return service.playbackStatus(a.playback_id);
    case 'playback_pause':return service.controlPlayback('pause',undefined,a.playback_id);
    case 'playback_resume':return service.controlPlayback('resume',undefined,a.playback_id);
    case 'playback_seek':return service.controlPlayback('seek',a.frame,a.playback_id);
    case 'playback_stop':return service.controlPlayback('stop',undefined,a.playback_id);
    case 'delivery_inspect':{const {readJson}=await import('../Adapters/node/workspace/storage.js');const {join}=await import('node:path');const {portablePath}=await import('../Adapters/node/workspace/assets.js');try{const m=await readJson(join(service.dir(a.project_id),'outputs','manifest.json'));return {...m,available:true,files:m.files.map((f:any)=>({...f,server_path:join(service.dir(a.project_id),'outputs',portablePath(f.path))}))};}catch(e:any){if(e.code==='ENOENT')return {available:false,project_id:a.project_id};throw e;}}
    case 'content_discover_roots': return new ContentCatalog(service).discover();
    case 'content_register_root': return new ContentCatalog(service).register(a.name,a.path,a.family);
    case 'content_index': return new ContentCatalog(service).index(a.root_ids,a.max_files,a.max_seconds);
    case 'project_document': return a.revision===undefined?service.readDocument(a.project_id):parseDocument({...await revisionSnapshot(service.dir(a.project_id),a.revision),id:a.project_id});
    case 'project_history': return service.history(a.project_id,a.offset,a.limit);
    case 'project_save': return saveProject(service,a.project_id,{include_audio:a.include_audio});
    case 'project_open': return importBundle(service,a.path,a.project_id);
    case 'export_start': return startExport(service,a);
    case 'mastering_add_song': return service.addMasteringSong(a);
    case 'mastering_create_version': return service.createMasteringVersion(a);
    case 'playback_set_volume': return service.setPlaybackVolume(a.gain_db,a.playback_id);
    case 'playback_set_mix': return service.setPlaybackMix(a.changes,a.playback_id);
    case 'content_search': return new ContentCatalog(service).search(a.query,a.family,a.limit,a.offset);
    case 'content_bind_preset': return new ContentCatalog(service).bind(a.content_id,a.preset_id,a.probe_id,a.description);
    case 'midi_inspect': return inspectMidi(a.path);
    case 'midi_import': return importMidi(service,a);
    case 'mixer_inspect':{const p=await service.inspect(a.project_id,false);const {readJson}=await import('../Adapters/node/workspace/storage.js');const {join}=await import('node:path');let meters;try{const last=await readJson(join(service.dir(a.project_id),'state','mixer.json'));meters={revision:last.revision,stale:last.revision!==p.revision,tracks:last.tracks.map((t:any)=>({id:t.id,meter:t.meter})),returns:last.returns.map((b:any)=>({id:b.id,meter:b.meter}))};}catch(e:any){if(e.code!=='ENOENT')throw e;}return {revision:p.revision,tracks:p.tracks.map(({notes,...t}:any)=>t),returns:p.buses,master_effects:p.master_effects,meters,meters_mode:'last_offline_render'};}
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
    case 'system_capabilities': {const engine=await service.engine.describe();return { engine,formats:engine.plugin_formats,realtime_playback:engine.features.includes('playback.v1'),sample_rate:engine.sample_rates.length===1?engine.sample_rates[0]:undefined, project_schema: 3, home_schema:1, home_paths:{projects:service.paths.projects,plugins:service.paths.plugins,engine:service.paths.engine,controllers:service.paths.controllers,settings:service.paths.settings}, ppq: 960, instrument_selection_policy:'plugin_first; inspect content libraries and audition before choosing. Basic sounds only with explicit allow_basic.', builtin_sounds: [],
      limitations: ['fixed tempo and 48kHz stereo for offline rendering and live playback', 'live playback uses a pinned revision; stop and restart after project edits', 'static latency only; changes during processing require restart', 'instrument/insert/master automation at 64-sample control intervals; no CC/sidechains yet', 'LUFS/true peak measurement requires FFmpeg; no automatic listening judgment', 'one-level pre/post-fader sends; bus-to-bus routing unsupported', 'bundle import capped at 512 MiB compressed / 1 GiB expanded', 'audio input fixed at 48 kHz; explicit SRC required for other rates'] };}
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
    case 'separation_start':return startSeparation(service,a);
    case 'separation_export':return exportSeparation(service,a);
    case 'project_create': return service.create(a);
    case 'project_inspect': return service.inspect(a.project_id, a.include_notes);
    case 'project_apply': return service.apply(a);
    case 'project_restore': return service.restore(a);
    case 'render_start': return service.startRenderRequest(a.project_id, a.tail_seconds, a.track_id,a.request_id,a.rerender_tracks);
    case 'job_status': return service.jobStatus(a.job_id);
    case 'job_cancel': return service.cancel(a.job_id);
    case 'audio_analyze': return service.engine.analyze({ path: a.path });
    case 'export_midi': return service.exportMidi(a.project_id);
    case 'export_project': return service.exportProject(a.project_id);
    case 'project_import': return service.importProject(a.project, a.project_id);
  }
}

export function createLocalApplication(service:Service):ApplicationPort {
 return {protocolVersion:1,contract:applicationContract,instructions:"AIDAW is a Vibe Coding DAW: AI edits authored projects; GUI and controllers provide immediate playback and file operations. Use system_capabilities to inspect this server. For authored project edits only: read active_context_get and project_document, use the current base_revision and a unique request_id, then recheck the selected target before committing. Honor an explicit user target; no selection is not permission to pick any project. Listening revisions and A/B selections do not imply edit targets or acceptance. New projects require composition, mastering or separation kind. For sound selection: discover/scan installed plugins and index/search their internal libraries; choose and record an exact patch/state. Never silently replace a requested or failed instrument. Basic instruments require explicit user or test/sketch intent; AIDAW GM is an explicitly selectable standard plugin. Discovery is not load, license or audio verification. Claim audio review only after actually listening to and evaluating the audio; otherwise report metadata inference. All tool paths are server paths: remote clients upload input and retrieve authorized artifacts over authenticated HTTP. Keep DSP on the server. Check job success and outputs before claiming export completion. Local agents start at AGENTS.md and read only the task workflow; remote clients use operation descriptions.",definitions,invoke:(name,input)=>invokeLocal(service,name,input),close:()=>service.close()};
}
