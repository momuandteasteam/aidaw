/** Project-scoped separation controls use the shared application API and host file dialogs. */
export function setupSeparation({bridge,getState,reload,stop}){
 const $=id=>document.getElementById(id),dialog=$('separationDialog');
 let projectId=null,jobId=null,pollTimer,busy=false,request=0,doc;
 const api=(name,args)=>bridge.api(name,args);
 const status=text=>{$('separationStatus').textContent=text;};
 function enable(){for(const button of dialog.querySelectorAll('[data-separation-action]'))button.disabled=busy||Boolean(jobId);$('separationCancel').disabled=!jobId;}
 async function refresh(){doc=await api('project_document',{project_id:projectId});$('separationName').textContent=doc.name;draw();}
 function draw(){
  const list=$('separationStems');list.replaceChildren();for(const track of doc?.composition?.tracks??[]){
   const row=document.createElement('div');row.className='stem-row';const name=document.createElement('span');name.textContent=track.name;row.append(name);
   for(const key of ['mute','solo']){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=track[key];box.disabled=busy||Boolean(jobId);label.append(box,document.createTextNode(key==='mute'?'ミュート':'ソロ'));row.append(label);
    box.addEventListener('change',()=>void action(async()=>{await stop();await api('project_apply',{project_id:projectId,base_revision:doc.revision,request_id:crypto.randomUUID(),operations:[{op:'set_track',track_id:track.id,changes:{[key]:box.checked}}]});await refresh();await reload();}));}
   list.append(row);
  }
 }
 async function action(fn){if(busy||jobId)return;busy=true;enable();try{await fn();}catch(e){status(e.message??String(e));}finally{busy=false;enable();draw();}}
 async function poll(token,save){
  try{const job=await api('job_status',{job_id:jobId});if(token!==request)return;status(job.state==='queued'?'順番待ち（再生中なら停止してください）':job.state==='running'?'処理中…':job.state==='succeeded'?'完了':job.error??job.state);
   if(['queued','running'].includes(job.state)){pollTimer=setTimeout(()=>void poll(token,save),800);return;}
   jobId=null;busy=false;enable();await refresh();await reload();if(job.state==='succeeded'&&save&&job.files?.[0])await bridge.saveOutput(job.files[0].path);
  }catch(e){status(e.message??String(e));jobId=null;busy=false;enable();}
 }
 $('separationStart').addEventListener('click',()=>void action(async()=>{
  const path=await bridge.chooseFile('audio');if(!path)return;await stop();const asset=await api('asset_import',{project_id:projectId,path,role:'source'});await refresh();
  const job=await api('separation_start',{project_id:projectId,source_asset_id:asset.id,base_revision:doc.revision,request_id:crypto.randomUUID()});jobId=job.job_id;status('分離を開始しました');pollTimer=setTimeout(()=>void poll(++request,false),300);
 }));
 for(const [button,kind]of [['separationZip','stems'],['separationMix','mix']])$(button).addEventListener('click',()=>void action(async()=>{
  await stop();await refresh();const job=await api('separation_export',{project_id:projectId,revision:doc.revision,request_id:crypto.randomUUID(),kind,format:$('separationFormat').value});jobId=job.job_id;status('書き出しを開始しました');pollTimer=setTimeout(()=>void poll(++request,true),300);
 }));
 $('separationCancel').addEventListener('click',async()=>{if(jobId){try{await api('job_cancel',{job_id:jobId});}catch(e){status(String(e));}}});
 $('separationClose').addEventListener('click',()=>dialog.close());
 return {async open(){const state=getState();if(state.document?.kind!=='separation')throw Error('新規プロジェクトで「ステム分離」を選んでください');if(jobId&&projectId!==state.projectId)throw Error('前の分離処理が完了してから切り替えてください');projectId=state.projectId;await refresh();enable();dialog.showModal();},dispose(){clearTimeout(pollTimer);request++;}};
}
