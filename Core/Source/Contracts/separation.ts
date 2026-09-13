export interface SeparationPort {
 readonly id:string;
 readonly model:string;
 separate(input:{path:string;outputDirectory:string;signal:AbortSignal}):Promise<Array<{name:string;path:string}>>;
}
