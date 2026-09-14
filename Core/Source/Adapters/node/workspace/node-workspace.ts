import {mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {WorkspacePort,WorkspaceChange} from '../../../Contracts/workspace.js';
import {parseDocument} from '../../../Domain/domain.js';
import {id} from '../../../Domain/schema.js';
import {homePaths} from './home.js';
import {atomicJson,locked,readJson} from './storage.js';
import {initializeHistory,writeRevision,listHistory,ensureHistory} from './history.js';
import {layout,newJob,revisionSnapshot} from './layout.js';
import {writeProjectViews} from './project-views.js';
type Document=ReturnType<typeof parseDocument>;
interface Envelope {history?:{head_revision:number;head_hash:string};project:Document;receipts:Record<string,{fingerprint:string;revision:number;job_id?:string}>}
/** Owns filesystem transactions, compare-and-swap, receipts and differential history. */
export class NodeWorkspace implements WorkspacePort<Document> {
 private readonly projects:string;
 constructor(root:string){this.projects=homePaths(root).projects;}
 private dir(projectId:string){return join(this.projects,id.parse(projectId));}
 private async envelope(projectId:string){const e=await readJson<Envelope>(join(this.dir(projectId),'project.json'));parseDocument(e.project);return e;}
 async create(document:Document){
  const dir=this.dir(document.id);await mkdir(this.projects,{recursive:true});await mkdir(dir);
  await layout(dir,'kind' in document?document.kind:'composition');
  const history=await initializeHistory(dir,document);await atomicJson(join(dir,'project.json'),{project:document,history,receipts:{}});await writeProjectViews(dir,document);
 }
 async read(projectId:string){return parseDocument((await this.envelope(projectId)).project);}
 async readRevision(projectId:string,revision:number){return parseDocument(await revisionSnapshot(this.dir(projectId),revision));}
 async history(projectId:string,offset=0,limit=50){
  const dir=this.dir(projectId);await locked(join(dir,'temp','project.lock'),async()=>{const e=await this.envelope(projectId);if(!e.history){e.history=await ensureHistory(dir,e.project);await atomicJson(join(dir,'project.json'),e);}});
  return listHistory(dir,offset,limit);
 }
 async list(){
  let names:string[];try{names=await readdir(this.projects);}catch(e:any){if(e.code==='ENOENT')return [];throw e;}
  const found=await Promise.all(names.filter(name=>id.safeParse(name).success).map(async name=>{try{const p=await this.read(name);return {project_id:p.id,name:p.name,revision:p.revision,kind:('kind' in p?p.kind:'composition') as 'composition'|'mastering'|'separation'};}catch(e:any){if(e.code==='ENOENT')return undefined;throw e;}}));return found.filter((p):p is NonNullable<typeof p>=>p!==undefined);
 }
 async change(request:WorkspaceChange,prepare:(current:Document,context:{workDirectory?:string})=>Promise<Document>){
  const {projectId,baseRevision:base,requestId,fingerprint:hash}=request;id.parse(requestId);const dir=this.dir(projectId);
  return locked(join(dir,'temp','project.lock'),async()=>{
   const e=await this.envelope(projectId),prior=e.receipts[requestId];
   if(prior){if(prior.fingerprint!==hash)throw new Error('request_id reused with different content');return {project_id:projectId,revision:prior.revision,job_id:prior.job_id,replayed:true};}
   if(e.project.revision!==base)throw new Error(`Revision conflict: expected ${base}, current ${e.project.revision}`);
   const job=await newJob(dir,{kind:'project_change',request_id:requestId,summary:request.summary,base_revision:base});let committed=false;
   try{
    const next=parseDocument(await prepare(parseDocument(structuredClone(e.project)),{workDirectory:join(job.path,'work')}));
    if(next.id!==projectId||next.revision!==base+1)throw new Error('Invalid prepared project identity or revision');
    const history=await writeRevision(dir,e.project,next,{request_id:requestId,summary:request.summary,kind:request.restoreRevision!==undefined?'restore':'edit',restored_from_revision:request.restoreRevision});
    await atomicJson(join(job.path,'snapshots','revision.json'),{before:base,after:next.revision,head_hash:history.head_hash});
    e.project=next;e.history=history;e.receipts[requestId]={fingerprint:hash,revision:next.revision,job_id:job.id};await atomicJson(join(dir,'project.json'),e);committed=true;
    await writeProjectViews(dir,next).catch(()=>{});await atomicJson(join(job.path,'status.json'),{id:job.id,state:'succeeded',revision:next.revision}).catch(()=>{});
    return {project_id:projectId,revision:next.revision,job_id:job.id,replayed:false};
   }catch(error){await atomicJson(join(job.path,'status.json'),{id:job.id,state:committed?'succeeded':'failed',committed,error:String(error)}).catch(()=>{});throw error;}
  });
 }
}
