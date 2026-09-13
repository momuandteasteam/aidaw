import type { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key:string]:JsonValue };
export interface ApplicationDescriptor {
 name:'aidaw.application';version:{major:number;minor:number};features:readonly string[];
}
export const applicationContract:ApplicationDescriptor=Object.freeze({name:'aidaw.application',version:Object.freeze({major:1,minor:0}),features:Object.freeze(['commands.v1'])});
export function negotiateApplication(application:ApplicationPort,requirements:{major:number;minimumMinor:number;features:readonly string[]}={major:1,minimumMinor:0,features:['commands.v1']}):ApplicationDescriptor {
 const descriptor=application.contract;
 if(application.protocolVersion!==1||descriptor?.name!=='aidaw.application'||descriptor.version.major!==requirements.major)throw new Error('Unsupported application protocol major');
 if(!Number.isSafeInteger(descriptor.version.minor)||descriptor.version.minor<requirements.minimumMinor)throw new Error('Application protocol minor is insufficient');
 for(const feature of requirements.features)if(!descriptor.features.includes(feature))throw new Error(`Application feature unavailable: ${feature}`);
 return descriptor;
}
/** Transport-independent application boundary. No native engine, filesystem or GUI handles cross it. */
export interface ApplicationPort {
 readonly protocolVersion:1;
 readonly contract:ApplicationDescriptor;
 readonly instructions?:string;
 readonly definitions:Readonly<Record<string,{description:string;schema:z.ZodObject<any>}>>;
 invoke(name:string,input:unknown):Promise<JsonValue>;
 close():Promise<void>;
}
export class ArtifactError extends Error {
 constructor(readonly status:400|403|404|413,message:string){super(message);}
}
export interface ArtifactPort {
 upload(filename:string,body:AsyncIterable<Uint8Array>,maxBytes:number):Promise<unknown>;
 download(identifier:string):Promise<{bytes:number;contentType:string;body:AsyncIterable<Uint8Array>}>;
}
