/** Output names belong to the native server, never Chromium's media-device IDs. */
export function outputNames(data){
 const items=data.devices??data.output_devices??data.device_types?.flatMap(type=>type.outputs)??[];
 return [...new Set(items.map(item=>typeof item==='string'?item:item.name).filter(name=>typeof name==='string'&&name))];
}
export function setupAudioSettings({select,dialog,status,bridge,window:win=window}){
 let selected='',names=[],signature='',pending=null,disposed=false,generation=0;
 function draw(){
  const rows=[['','システムの既定出力'],...names.map(name=>[name,name])];
  if(selected&&!names.includes(selected))rows.push([selected,`${selected}（未接続）`]);
  const next=JSON.stringify(rows);
  if(next!==signature){
   select.replaceChildren(...rows.map(([value,label])=>{const option=select.ownerDocument.createElement('option');option.value=value;option.textContent=label;return option;}));signature=next;
  }
  select.value=selected;
 }
 async function refresh(){
  if(disposed||!dialog.open)return;
  if(pending)return pending;
  const epoch=generation;
  pending=(async()=>{
   try{
    const data=await bridge.api('playback_devices',{});
    if(disposed||!dialog.open||epoch!==generation)return;
    names=outputNames(data);draw();status.textContent='';
   }catch(error){if(!disposed&&dialog.open&&epoch===generation)status.textContent=`出力デバイスを取得できません。再試行します: ${error.message??error}`;}
   finally{pending=null;}
  })();
  return pending;
 }
 const observer=new win.MutationObserver(()=>{generation++;if(dialog.open)void refresh();});
 observer.observe(dialog,{attributes:true,attributeFilter:['open']});
 const timer=win.setInterval(()=>{if(dialog.open)void refresh();},2000);
 const focus=()=>void refresh();win.addEventListener('focus',focus);
 async function change(){
  const previous=selected;selected=select.value;
  try{await bridge.saveAudioPreferences(selected);status.textContent='';}
  catch(error){selected=previous;draw();status.textContent=`出力設定を保存できません: ${error.message??error}`;}
 }
 select.addEventListener('change',change);
 return {
  configure(data,preferences){selected=preferences.output_device??'';names=outputNames(data);draw();},
  refresh,
  dispose(){disposed=true;generation++;observer.disconnect();win.clearInterval(timer);win.removeEventListener('focus',focus);select.removeEventListener('change',change);}
 };
}
