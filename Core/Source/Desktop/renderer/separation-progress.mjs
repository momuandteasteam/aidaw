export function openSeparationProgress(engine,cancel){
 const dialog=document.createElement('dialog');dialog.id='separationProgressDialog';dialog.setAttribute('aria-label','分離方式を切替');dialog.innerHTML='<h2>分離方式を切替</h2><p data-engine></p><progress aria-label="分離の進捗"></progress><p role="status"></p><button type="button">キャンセル</button>';
 dialog.querySelector('[data-engine]').textContent=engine==='demucs'?'Spleeter → Demucs':'Demucs → Spleeter';const bar=dialog.querySelector('progress'),status=dialog.querySelector('[role=status]'),button=dialog.querySelector('button');bar.style.width='100%';
 dialog.addEventListener('cancel',e=>e.preventDefault());button.addEventListener('click',async()=>{button.disabled=true;try{await cancel();status.textContent='中止しています…';}catch(e){status.textContent=e.message;button.disabled=false;}});document.body.append(dialog);dialog.showModal();
 return {update(p){status.textContent=p.phase;if(Number.isFinite(p.completed)&&p.total>0){bar.max=p.total;bar.value=p.completed;}else bar.removeAttribute('value');},close(){dialog.close();dialog.remove();}};
}
