import type {AudioPlan,ProcessorReference} from './audio-plan.js';
export {audioPlan,processorReference} from './audio-plan.js';
export type {AudioPlan,ProcessorReference} from './audio-plan.js';
/** Engine contract v1: no process, native command, or worker file handles cross this port. */
export type Data = null | boolean | number | string | Data[] | {[key:string]:Data|undefined};
export interface EngineOptions {timeout?:number;signal?:AbortSignal;workDir?:string}
export interface EngineDescriptor {id:string;version:string;adapter_id:string;adapter_version:string;contract:{major:number;minor:number};content_fingerprint:string;features:string[];sample_rates:number[];plugin_formats:string[]}
export class EngineContractError extends Error {constructor(readonly code:string,message:string,readonly retryable=false){super(message);this.name='EngineContractError';}}
export interface AudioAnalysis {frames:number;sample_rate:number;channels:number;duration_seconds:number;sample_peak:number;rms:number;clipped_samples:number;silent:boolean;measurement:string}
export interface ParameterDescriptor {id:string;name:string;unit:string;value:number;display:string;automatable:boolean;steps:number;choices?:Array<{value:number;display:string}>}
export interface PluginInspection {state_base64:string;parameters:ParameterDescriptor[];programs:Array<{index:number;name:string}>;buses:Data[];program_count:number;latency_samples:number;tail_seconds:number;latency_stage:string}
export interface RenderRequest {plan:AudioPlan;output:string;tail_seconds:number;sample_format?:string}
export interface RenderResult {output:string;analysis:AudioAnalysis;revision:number;automation:Data;latency_compensation:{tracks:Data[];master_samples:number;trimmed_samples:number;[key:string]:unknown}}
export interface PlaybackMixChange {track_id?:string;bus_id?:string;mute?:boolean;solo?:boolean;gain_db?:number;pan?:number}
export interface PlaybackRequest {plan:AudioPlan;start_frame:string;tail_seconds:number;loop:boolean;loop_start_frame:string;loop_end_frame:string;output_device:string;monitor_gain_db:number}
export type PlaybackState='queued'|'starting'|'playing'|'paused'|'stopped'|'completed'|'failed'|'cancelled';
export interface PlaybackStatus {state:PlaybackState;position_frame?:string;duration_frames?:string;control_sequence?:number;[key:string]:unknown}
export type PlaybackControl={action:'pause'|'resume'|'stop'}|{action:'seek';frame:string}|{action:'set_mix';changes:PlaybackMixChange[]}|{action:'set_volume';gain_db:number};
export interface PlaybackSession {ready:Promise<PlaybackStatus>;done:Promise<PlaybackStatus>;status():Promise<PlaybackStatus|undefined>;control(change:PlaybackControl):Promise<void>;close():Promise<void>}
export interface AudioOutputs {device_types:Array<{name:string;outputs:string[]}>;default_output:string;required_sample_rate:number}
export interface PluginMetadata {plugin_id:string;name:string;vendor:string;version:string;format:string;instrument:boolean;inputs:number;outputs:number;location:string}
export interface EngineRequests {
 render:RenderRequest; analyze:{path:string}; compareAudio:{reference:string;paths:string[]};
 discoverPlugins:{format:string;search_path?:string};scanPlugin:{format:string;location:string};inspectPlugin:{plugin:ProcessorReference};
 loadModoBassPreset:{plugin:ProcessorReference;path:string};loadKontaktPreset:{plugin:ProcessorReference;path:string;probe_pitch:number};listAudioOutputs:Record<string,never>;
}
export interface EngineResults {
 render:RenderResult;analyze:AudioAnalysis;compareAudio:{max_absolute_difference:number;rms_difference:number;frames:number;exact_samples:boolean};
 discoverPlugins:{candidates:string[]};scanPlugin:{plugins:PluginMetadata[]};inspectPlugin:PluginInspection;
 loadModoBassPreset:PluginInspection & {matched:unknown;[key:string]:unknown};loadKontaktPreset:PluginInspection & {[key:string]:unknown};listAudioOutputs:AudioOutputs;
}
export interface EngineDriver {
 describe():Promise<EngineDescriptor>;
 invoke<K extends keyof EngineRequests>(operation:K,request:EngineRequests[K],options?:EngineOptions):Promise<EngineResults[K]>;
 startPlayback(request:PlaybackRequest,options?:EngineOptions):Promise<PlaybackSession>;
 close():Promise<void>;
}
export interface EnginePort {
 describe():Promise<EngineDescriptor>;
 render(request:RenderRequest,options?:EngineOptions):Promise<RenderResult>;
 analyze(request:EngineRequests['analyze'],options?:EngineOptions):Promise<AudioAnalysis>;
 compareAudio(request:EngineRequests['compareAudio'],options?:EngineOptions):Promise<EngineResults['compareAudio']>;
 discoverPlugins(request:EngineRequests['discoverPlugins'],options?:EngineOptions):Promise<EngineResults['discoverPlugins']>;
 scanPlugin(request:EngineRequests['scanPlugin'],options?:EngineOptions):Promise<EngineResults['scanPlugin']>;
 inspectPlugin(request:EngineRequests['inspectPlugin'],options?:EngineOptions):Promise<PluginInspection>;
 loadModoBassPreset(request:EngineRequests['loadModoBassPreset'],options?:EngineOptions):Promise<EngineResults['loadModoBassPreset']>;
 loadKontaktPreset(request:EngineRequests['loadKontaktPreset'],options?:EngineOptions):Promise<EngineResults['loadKontaktPreset']>;
 listAudioOutputs():Promise<AudioOutputs>;
 startPlayback(request:PlaybackRequest,options?:EngineOptions):Promise<PlaybackSession>;
 close():Promise<void>;
}
