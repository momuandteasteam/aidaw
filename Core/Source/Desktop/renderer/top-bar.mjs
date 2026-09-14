/** Desktop chrome routes to the existing runtime; it owns no audio or project state. */
export function setupTopBar({getState,dispatch,dispatchAction,chooseProject,onError}){
 const $=id=>document.getElementById(id),trigger=$('fileMenuButton'),menu=$('fileMenu'),list=$('projectListDialog');
 const lifecycle=new AbortController(),{signal}=lifecycle;
 let listSignature='',refreshing=false,selecting=false;
 const items=()=>[...menu.querySelectorAll('button:not(:disabled):not([hidden])')];
 function closeMenu(restore=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(restore)trigger.focus();}
 function openMenu(last=false){update();menu.hidden=false;trigger.setAttribute('aria-expanded','true');const enabled=items();(last?enabled.at(-1):enabled[0])?.focus();}
 function openDialog(id){closeMenu();const dialog=$(id);if(!dialog.open)dialog.showModal();}
 trigger.addEventListener('click',()=>menu.hidden?openMenu():closeMenu(true),{signal});
 trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openMenu(event.key==='ArrowUp');}},{signal});
 menu.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
  if(event.key==='Tab'){closeMenu(true);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const enabled=items(),index=enabled.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+(event.key==='ArrowUp'?-1:1)+enabled.length)%enabled.length;
  enabled[next]?.focus();
 },{signal});
 menu.addEventListener('click',async event=>{
  const button=event.target.closest('[data-command]');if(!button||button.disabled)return;
  const type=button.dataset.command;closeMenu(true);
  try{
   if(type==='projectList'){await dispatch({type:'refresh'});$('projectListStatus').textContent='';listSignature='';drawProjects();openDialog('projectListDialog');}
   else if(type==='audioExport')await dispatchAction({type:'audio.export'});
   else await dispatch({type});
  }catch(error){onError(error);}
 },{signal});
 document.addEventListener('pointerdown',event=>{if(!event.target.closest('#fileMenu,#fileMenuButton'))closeMenu();},{signal});
 for(const [button,dialog,close]of [['settingsButton','settingsDialog','settingsClose'],['assignmentButton','assignmentDialog','assignmentClose']]){
  $(button).addEventListener('click',()=>openDialog(dialog),{signal});
  $(close).addEventListener('click',()=>$(dialog).close(),{signal});
  $(dialog).addEventListener('close',()=>$(button).focus(),{signal});
 }
 $('projectListClose').addEventListener('click',()=>list.close(),{signal});
 list.addEventListener('close',()=>trigger.focus(),{signal});
 async function selectProject(id){
  if(selecting)return;selecting=true;listSignature='';drawProjects();
  try{await chooseProject(id);list.close();}
  catch(error){$('projectListStatus').textContent=error.message??String(error);onError(error);}
  finally{selecting=false;listSignature='';drawProjects();}
 }
 function drawProjects(){
  const state=getState(),projects=state.projects??[];
  const signature=JSON.stringify([projects.map(p=>[p.project_id,p.name,p.kind]),state.projectId,selecting]);
  if(signature===listSignature)return;listSignature=signature;
  const container=$('projectListItems');container.replaceChildren();
  for(const project of projects){
   const button=document.createElement('button');button.type='button';button.disabled=selecting;button.textContent=project.name??project.project_id;
   const detail=document.createElement('small');detail.textContent=`${project.kind==='mastering'?'マスタリング':project.kind==='separation'?'ステム分離':'曲制作'}${project.project_id===state.projectId?' · 選択中':''}`;button.append(detail);
   button.addEventListener('click',()=>void selectProject(project.project_id));container.append(button);
  }
  if(!projects.length)$('projectListStatus').textContent='プロジェクトはまだありません。ファイルメニューから新規作成またはインポートできます。';
 }
 $('projectListRefresh').addEventListener('click',async()=>{
  if(refreshing)return;refreshing=true;$('projectListRefresh').disabled=true;$('projectListStatus').textContent='更新中…';
  try{await dispatch({type:'refresh'});$('projectListStatus').textContent='一覧を更新しました。';listSignature='';drawProjects();}
  catch(error){$('projectListStatus').textContent=error.message??String(error);onError(error);}
  finally{refreshing=false;$('projectListRefresh').disabled=false;}
 },{signal});
 function update(){
  const state=getState();const audio=menu.querySelector('[data-command="audioExport"]');if(audio)audio.textContent=state.document?.kind==='mastering'?'選択中の音を書き出す…':'音声を書き出す…';for(const button of menu.querySelectorAll('[data-needs-project]')){button.disabled=!state.document||Boolean(state.busy);}
  for(const b of menu.querySelectorAll('[data-command]')){const type=b.dataset.command;if(['sendSeparation','sendMastering'].includes(type))b.disabled=!state.document||state.document.kind!=='composition'||Boolean(state.busy);if(type==='importAudio')b.disabled=!['composition','mastering'].includes(state.document?.kind)||Boolean(state.busy);}
  if(list.open)drawProjects();
 }
 update();return {update,dispose(){lifecycle.abort();}};
}
