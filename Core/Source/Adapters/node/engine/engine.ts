import {JuceFileDriver} from './juce-file-driver.js';
import {EngineContractError,type EngineDriver,type EnginePort,type EngineRequests,type EngineResults,type EngineOptions,type PlaybackRequest} from '../../../Contracts/engine-contracts.js';
export type {PlaybackMixChange,EnginePort,EngineDriver} from '../../../Contracts/engine-contracts.js';
/** Application facade; the injected driver exclusively owns the native wire representation. */
export class Engine implements EnginePort {
 private readonly driver:EngineDriver;
 constructor(executable?:string,options:{home?:string;fallbackExecutable?:string;driver?:EngineDriver}={}){this.driver=options.driver??new JuceFileDriver(executable,options);}
 async describe(){const d=await this.driver.describe();if(d.contract.major!==1)throw new EngineContractError('CONTRACT_INCOMPATIBLE','Engine contract major 1 is required');return d;}
 private async invoke<K extends keyof EngineRequests>(operation:K,request:EngineRequests[K],options?:EngineOptions):Promise<EngineResults[K]>{
  const d=await this.describe();if(!d.features.includes(operation+'.v1'))throw new EngineContractError('FEATURE_UNAVAILABLE',`Engine does not support ${operation}`);return this.driver.invoke(operation,request,options);
 }
 render(request:EngineRequests['render'],options?:EngineOptions){return this.invoke('render',request,options);}
 analyze(request:EngineRequests['analyze'],options?:EngineOptions){return this.invoke('analyze',request,options);}
 compareAudio(request:EngineRequests['compareAudio'],options?:EngineOptions){return this.invoke('compareAudio',request,options);}
 discoverPlugins(request:EngineRequests['discoverPlugins'],options?:EngineOptions){return this.invoke('discoverPlugins',request,options);}
 scanPlugin(request:EngineRequests['scanPlugin'],options?:EngineOptions){return this.invoke('scanPlugin',request,options);}
 inspectPlugin(request:EngineRequests['inspectPlugin'],options?:EngineOptions){return this.invoke('inspectPlugin',request,options);}
 loadModoBassPreset(request:EngineRequests['loadModoBassPreset'],options?:EngineOptions){return this.invoke('loadModoBassPreset',request,options);}
 loadKontaktPreset(request:EngineRequests['loadKontaktPreset'],options?:EngineOptions){return this.invoke('loadKontaktPreset',request,options);}
 listAudioOutputs(){return this.invoke('listAudioOutputs',{});}
 async startPlayback(request:PlaybackRequest,options?:EngineOptions){if(options?.signal?.aborted)throw new EngineContractError('CANCELLED','Playback cancelled');const d=await this.describe();if(!d.features.includes('playback.v1'))throw new EngineContractError('FEATURE_UNAVAILABLE','Engine does not support playback');if(request.prepared_comparison&&!d.features.includes('playback.prepared_comparison.v1'))throw new EngineContractError('FEATURE_UNAVAILABLE','Engine does not support prepared comparisons');if(request.start_paused&&!d.features.includes('playback.initial_pause.v1'))throw new EngineContractError('FEATURE_UNAVAILABLE','Engine does not support paused start');return this.driver.startPlayback(request,options);}
 close(){return this.driver.close();}
}
