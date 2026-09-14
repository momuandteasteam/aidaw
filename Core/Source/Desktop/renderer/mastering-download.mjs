/** Options and destination stay in a modal; the control surface keeps its mode. */
export function setupMasteringDownload(bridge){
 const dialog=document.createElement('dialog');dialog.id='masteringDownloadDialog';dialog.setAttribute('aria-label','選択中の音を書き出す');
 dialog.innerHTML=`<form><h2>選択中の音を書き出す</h2><p data-target></p><label>フォーマット<select name="format"><option value="wav">WAV</option><option value="flac">FLAC</option><option value="mp3">MP3</option></select></label><label>サンプルレート<select name="rate"><option value="44100">44.1 kHz</option><option value="48000" selected>48 kHz</option><option value="88200">88.2 kHz</option><option value="96000">96 kHz</option></select></label><label data-depth>ビット深度<select name="depth"><option value="16">16 bit</option><option value="24" selected>24 bit</option><option value="32">32 bit float</option></select></label><label data-bitrate hidden>MP3ビットレート（CBR）<select name="bitrate"><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320" selected>320 kbps</option></select></label><label>ファイル名<input name="filename" required></label><label>保存先<input name="destination" readonly placeholder="保存先を選択してください"></label><button type="button" data-browse>保存先を選択…</button><p>開始時に再生を停止します。位置は保持されます。</p><p role="status"></p><div class="dialog-actions"><button type="button" data-cancel>キャンセル</button><button type="submit">書き出し</button></div></form>`;
 document.body.append(dialog);const form=dialog.querySelector('form'),field=name=>form.elements.namedItem(name),status=dialog.querySelector('[role=status]');let resolve,selection,destination,beforeDownload,busy=false;
 function changed(){
  const format=field('format').value,mp3=format==='mp3';dialog.querySelector('[data-depth]').hidden=mp3;dialog.querySelector('[data-bitrate]').hidden=!mp3;
  for(const option of field('rate').options)option.disabled=mp3&&Number(option.value)>48000;
  if(mp3&&Number(field('rate').value)>48000)field('rate').value='48000';
  field('depth').options[2].disabled=format==='flac';if(format==='flac'&&field('depth').value==='32')field('depth').value='24';
  field('filename').value=field('filename').value.replace(/\.(wav|flac|mp3)$/i,'')+'.'+format;
  destination=null;field('destination').value='';
 }
 field('format').addEventListener('change',changed);
 field('filename').addEventListener('input',()=>{destination=null;field('destination').value='';});
 async function browse(){const result=await bridge.chooseDownloadPath(field('format').value,field('filename').value);if(result){destination=result;field('destination').value=result.path;}return result;}
 dialog.querySelector('[data-browse]').onclick=()=>void browse().catch(e=>status.textContent=e.message);
 function close(){if(busy)return;dialog.close();resolve?.(null);resolve=null;}
 dialog.querySelector('[data-cancel]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  try{
   if(!destination&&!await browse())return;
   busy=true;for(const el of form.elements)el.disabled=true;status.textContent='保存用音声を準備しています。再生中の場合は停止後に処理します。';
   const options={format:field('format').value,sample_rate:Number(field('rate').value),bit_depth:Number(field('depth').value),bitrate_kbps:Number(field('bitrate').value)};
   await beforeDownload?.();
   const result=await bridge.api('mastering_download',{...selection,options});const saved=await bridge.saveDownload(result.output,destination.path);
   dialog.close();resolve?.(saved);resolve=null;
  }catch(error){status.textContent=error.message??String(error);}
  finally{busy=false;for(const el of form.elements)el.disabled=false;}
 });
 return {open(args,label,onConfirm,suggestedName='master'){field('filename').value=suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)+'.'+field('format').value;beforeDownload=onConfirm;selection=structuredClone(args);destination=null;field('destination').value='';status.textContent='';dialog.querySelector('[data-target]').textContent=label;dialog.showModal();return new Promise(r=>resolve=r);},dispose(){dialog.remove();resolve?.(null);}};
}
