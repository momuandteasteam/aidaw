/** Each boundary evolves independently; major versions require an explicit converter. */
export interface ContractVersion {major:number;minor:number}
export interface ContractOffer {contract:string;version:ContractVersion;features:readonly string[]}
export class ContractMismatch extends Error {
 readonly code='CONTRACT_INCOMPATIBLE';
 constructor(message:string){super(message);this.name='ContractMismatch';}
}
export function negotiateContract(local:ContractOffer,remote:ContractOffer,required:readonly string[]=[]):ContractOffer {
 for(const offer of [local,remote])if(!Number.isSafeInteger(offer.version.major)||offer.version.major<1||!Number.isSafeInteger(offer.version.minor)||offer.version.minor<0)throw new ContractMismatch('Invalid contract version');
 if(local.contract!==remote.contract||local.version.major!==remote.version.major)throw new ContractMismatch(`Incompatible contract: ${remote.contract} v${remote.version.major}`);
 const features=local.features.filter(feature=>remote.features.includes(feature));
 for(const feature of required)if(!features.includes(feature))throw new ContractMismatch(`Required feature unavailable: ${feature}`);
 return {contract:local.contract,version:{major:local.version.major,minor:Math.min(local.version.minor,remote.version.minor)},features};
}
export interface VersionedDocument {contract:string;version:ContractVersion;payload:unknown}
/** Boundary-owned conversion, never implicit mutation or interpretation of opaque plugin state. */
export class DocumentReader<T> {
 private readonly decoders=new Map<string,(payload:unknown)=>T>();
 constructor(readonly contract:string){}
 register(version:ContractVersion,decode:(payload:unknown)=>T):this {
  const key=`${version.major}.${version.minor}`;
  if(this.decoders.has(key))throw new Error(`Decoder already registered: ${key}`);
  this.decoders.set(key,decode);return this;
 }
 read(document:VersionedDocument):T {
  if(document.contract!==this.contract)throw new ContractMismatch('Unexpected document contract');
  const decode=this.decoders.get(`${document.version.major}.${document.version.minor}`);
  if(!decode)throw new ContractMismatch('No explicit decoder for document version');
  return decode(document.payload);
 }
}
