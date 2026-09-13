import type {EnginePort} from '../Contracts/engine-contracts.js';
import type {ProcessingQueue} from '../Adapters/node/runtime/processing-queue.js';
/** Scheduling is an application concern, independent of the selected engine driver. */
export function withAudioQueue(engine:EnginePort,queue:ProcessingQueue):EnginePort {
 return new Proxy(engine,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(typeof value!=='function')return value;if(['describe','listAudioOutputs','startPlayback','close'].includes(String(key)))return value.bind(target);return (...args:unknown[])=>{const options=(args[1]??{}) as {signal?:AbortSignal};return queue.run(`engine_${String(key)}`,()=>value.apply(target,[args[0],{...options,signal:queue.signal}]),{signal:options.signal});};}});
}
