export interface WorkspaceDocument {id:string;name:string;revision:number;kind?:'composition'|'mastering'|'separation'}
export interface WorkspaceChange {projectId:string;baseRevision:number;requestId:string;fingerprint:string;summary?:string;restoreRevision?:number}
export interface WorkspaceReceipt {project_id:string;revision:number;job_id?:string;replayed:boolean}
export interface WorkspaceHistory {head_revision:number;total:number;entries:Array<{revision:number;[key:string]:unknown}>}
/** Authored documents and atomic edit history, independent of filesystem storage. */
export interface WorkspacePort<D extends WorkspaceDocument> {
 create(document:D):Promise<void>;
 read(projectId:string):Promise<D>;
 readRevision(projectId:string,revision:number):Promise<D>;
 history(projectId:string,offset:number,limit:number):Promise<WorkspaceHistory>;
 list():Promise<Array<{project_id:string;name:string;revision:number;kind:'composition'|'mastering'|'separation'}>>;
 change(request:WorkspaceChange,prepare:(current:D,context:{workDirectory?:string})=>Promise<D>):Promise<WorkspaceReceipt>;
}
