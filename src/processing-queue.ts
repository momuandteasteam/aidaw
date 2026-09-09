import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
interface Entry {controller:AbortController;id:string;kind:string;created_at:string;state:'queued'|'running';signal?:AbortSignal;work:()=>Promise<unknown>;resolve:(v:any)=>void;reject:(e:unknown)=>void;abort?:()=>void}
const context=new AsyncLocalStorage<{queue:ProcessingQueue;signal?:AbortSignal}>();
/** One execution lane for the complete song pipeline, including nested native calls. */
export class ProcessingQueue {
 private pending:Entry[]=[];private active?:Entry;private stopped=false;private idleWaiters:Array<()=>void>=[];
 get signal(){const c=context.getStore();return c?.queue===this?c.signal:undefined;}
 status(){return {max_active:1,policy:'FIFO; one complete audio operation at a time',active:this.active?this.summary(this.active):null,queued:this.pending.map(e=>this.summary(e)),persistence:'job snapshots/status are on disk; executable queue is in memory; no automatic restart replay'};}
 private summary(e:Entry){return {id:e.id,kind:e.kind,state:e.state,created_at:e.created_at};}
 async run<T>(kind:string,work:()=>Promise<T>,options:{id?:string;signal?:AbortSignal}={}):Promise<T>{
  if(context.getStore()?.queue===this){if(this.signal?.aborted)throw Error('Job cancelled');return work();}
  if(this.stopped)throw Error('Server is shutting down');if(this.pending.length>=200)throw Error('Processing queue is full (200 waiting operations)');if(options.signal?.aborted)throw Error('Job cancelled');
  return new Promise<T>((resolve,reject)=>{
   const controller=new AbortController();
   const entry:Entry={controller,id:options.id??randomUUID(),kind,created_at:new Date().toISOString(),state:'queued',work,resolve,reject,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal};
   entry.abort=()=>{const i=this.pending.indexOf(entry);if(i>=0){this.pending.splice(i,1);entry.signal?.removeEventListener('abort',entry.abort!);reject(Error('Job cancelled'));}};
   this.pending.push(entry);entry.signal?.addEventListener('abort',entry.abort,{once:true});this.pump();
  });
 }
 private pump(){
  if(this.active||this.stopped)return;const entry=this.pending.shift();if(!entry)return;
  entry.signal?.removeEventListener('abort',entry.abort!);this.active=entry;entry.state='running';
  void context.run({queue:this,signal:entry.signal},async()=>{try{if(entry.signal?.aborted)throw Error('Job cancelled');const value=await entry.work();if(entry.signal?.aborted)throw Error('Job cancelled');entry.resolve(value);}catch(e){entry.reject(e);}finally{this.active=undefined;this.pump();if(!this.active)for(const done of this.idleWaiters.splice(0))done();}});
 }
 idle(){return this.active?new Promise<void>(resolve=>this.idleWaiters.push(resolve)):Promise.resolve();}
 shutdown(){this.stopped=true;this.active?.controller.abort();for(const e of this.pending.splice(0)){e.signal?.removeEventListener('abort',e.abort!);e.reject(Error('Server shutting down before queued operation started'));}}
}
