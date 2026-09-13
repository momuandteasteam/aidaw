import {createDeckState,reduceDeckState,buildPads,commandForPad,pageItems,songsOf,songOf,graphOf,tracksOf,versionsOf,versionOf,isMastering,isActive,acceptsStatus,startFrame,comparisonLabel,auditionChanges} from '../../ControlSurface/model.mjs';
import {buildEncoders,commandForEncoder,encoderTarget,encoderSelection,adjustEncoderDraft} from '../../ControlSurface/encoders.mjs';
import {createSurfaceSnapshot,resolveSurfaceAction} from '../../ControlSurface/surface-contract.mjs';
export function createControlRuntime({application,host,onError=()=>{}}){
let state=createDeckState(),generation=0,pollTimer,pending=false,bootstrapping=true,disposed=false;
let artworkKey='',artworkUrl=null,artworkRequest=0;
let waveformKey='',waveform=null,overlay=null,overlayTimer,volumeQueue=Promise.resolve();
let contextSignature='',contextQueue=Promise.resolve(),contextPollAt=0,seekQueue=Promise.resolve();
let previewTimer,previewPromise=Promise.resolve(),transportIntent=0,sequence=0,errorSequence=0;
const listeners=new Set();
const requestId=()=>crypto.randomUUID();
const api=(name,args={})=>application.invoke(name,args);
const render=()=>{if(disposed)return;sequence++;for(const listener of listeners)listener(snapshot());};
const patch=values=>{if(disposed)return;state=reduceDeckState(state,{type:'patch',patch:values});void refreshArtwork();render();shareContext();void refreshWaveform();};
const error=e=>{if(!disposed){errorSequence++;onError(e);}};
const form=(...args)=>host.form(...args);
const target=()=>({project_id:state.projectId,...(isMastering(state)&&state.songId?{song_id:state.songId,version_id:versionOf(state)?.id}:{})});
const editArgs=()=>({project_id:state.projectId,base_revision:state.document.revision,request_id:requestId()});
const duration=()=>Number(state.playback?.duration_frames??(isMastering(state)?versionOf(state)?.duration_frames??versionOf(state)?.clip?.end_frame??0:graphOf(state).duration_frames??Math.round((graphOf(state).length_ticks??0)/(graphOf(state).ppq??960)*60/(graphOf(state).bpm??120)*48000)));
async function refreshArtwork(force=false){
 const key=state.document&&state.api.includes('project_artwork')?JSON.stringify([state.projectId,state.document.revision]):'';
 if(!force&&key===artworkKey)return;
 artworkKey=key;artworkUrl=null;const request=++artworkRequest;
 if(!key)return;
 try{const result=await api('project_artwork',{project_id:state.projectId});if(!disposed&&request===artworkRequest){artworkUrl=result?.data_url??null;render();}}catch{if(!disposed&&request===artworkRequest){artworkUrl=null;render();}}
}
async function refreshWaveform(){
 if(!state.document||isMastering(state)&&!songOf(state)||!state.api.includes('project_waveform'))return;
 const args={...target(),...(state.activeSlot?{comparison:state.activeSlot.toLowerCase()}:{}),bins:400};
 if(args.comparison)delete args.version_id;
 const key=JSON.stringify([args,state.document.revision]);if(key===waveformKey)return;waveformKey=key;waveform=null;render();
 try{const result=await api('project_waveform',args);if(key===waveformKey){waveform=result;render();}}catch(e){if(key===waveformKey){waveformKey='';error(e);}}
}
function shareContext(){
 if(!state.document||!state.api.includes('active_context_set'))return;
 const context={project_id:state.projectId,...(isMastering(state)&&state.songId?{song_id:state.songId,...(state.versionId&&!state.activeSlot?{version_id:state.versionId}:{}),...(state.activeSlot?{comparison:state.activeSlot.toLowerCase()}: {})}:{}),...(state.auditionRevision!==undefined?{revision:state.auditionRevision}:{})};
 const signature=JSON.stringify(context);if(signature===contextSignature)return;contextSignature=signature;
 contextQueue=contextQueue.catch(()=>{}).then(()=>api('active_context_set',context)).catch(e=>{contextSignature='';error(e);});
}
function exportSummary(){const album=state.exportScope==='album'&&isMastering(state);return `${album?'アルバム全曲':isMastering(state)?songOf(state)?.name??'曲未選択':state.document?.name??'未選択'} · ${state.formats.join(' / ').toUpperCase()} · ${album?songsOf(state).map(s=>`${s.name}: ${s.accepted_version_id??s.current_version_id}`).join('、'):isMastering(state)?versionOf(state)?.id??'版未選択':`R${state.document?.revision??'—'}`}`;}
async function reload(){if(!state.projectId)return;artworkKey='';const id=state.projectId,token=++generation;const doc=await api('project_document',{project_id:id});if(token!==generation||id!==state.projectId)return;const song=(doc.mastering?.songs??doc.songs??[]).find(s=>s.id===state.songId)??(doc.mastering?.songs??doc.songs??[])[0];patch({document:doc,trackId:tracksOf({document:doc}).some(t=>t.id===state.trackId)?state.trackId:tracksOf({document:doc})[0]?.id??null,songId:song?.id??null,versionId:song?(song.versions.some(v=>v.id===state.versionId)?state.versionId:song.current_version_id):state.versionId});}
async function refresh(){const result=await api('project_list');patch({projects:Array.isArray(result)?result:result.projects??[]});}
async function chooseProject(id){await stop();generation++;patch({projectId:id,document:null,songId:null,trackId:null,versionId:null,position:'0',playback:null,audition:null,activeSlot:null,auditionRevision:undefined});await reload();patch({mode:'listen',page:0,stack:[]});await contextQueue;}
async function navigate(mode){state=reduceDeckState(state,{type:'navigate',mode});if((mode==='revisionlist'||mode==='history')&&!isMastering(state))await loadHistory();if(mode==='fxparameters')await loadFxParameters();render();}
async function loadHistory(){const id=state.projectId,page=state.page;const history=await api('project_history',{project_id:id,offset:page*3,limit:3});if(id===state.projectId&&page===state.page)patch({history:history.entries??history.revisions??[],historyTotal:history.total,historyOffset:page*3});}
async function loadFxParameters(){
 const version=versionOf(state);if(!version)return;const context={project_id:state.projectId,song_id:state.songId,version_id:version.id,base_revision:state.document.revision,effects:structuredClone(version.effects)};await stop();
 const parameters=[];for(const [effectIndex,fx]of context.effects.entries()){for(const parameter of await inspectAllParameters(fx))parameters.push({id:`${effectIndex}:${parameter.id}`,name:`${effectIndex+1} · ${parameter.name??parameter.id}`,effectIndex,parameterId:parameter.id,value:parameter.value});}
 if(context.project_id===state.projectId&&context.song_id===state.songId&&context.version_id===versionOf(state)?.id)patch({fxParameters:parameters,fxParameterContext:context,fxParameterValues:{}});
}
async function inspectAllParameters(plugin){const parameters=[];let total=Infinity;while(parameters.length<total){const page=await api('plugin_inspect',{plugin,offset:parameters.length,limit:100});total=page.parameter_count??page.parameters.length;if(!page.parameters.length)break;parameters.push(...page.parameters);}return parameters;}
async function commitFxParameter(){
 const context=state.fxParameterContext,parameter=state.fxParameters?.find(p=>p.id===state.fxParameterId);if(!context||!parameter)return;
 if(context.project_id!==state.projectId||context.song_id!==state.songId||context.version_id!==versionOf(state)?.id||context.base_revision!==state.document.revision)throw new Error('作品か選択版が変更されています。パラメーター一覧を開き直してください。');
 const value=state.fxParameterValues?.[parameter.id]??parameter.value,effects=structuredClone(context.effects),fx=effects[parameter.effectIndex];fx.parameters=[...(fx.parameters??[]).filter(p=>p.id!==parameter.parameterId),{id:parameter.parameterId,value}];
 const request=requestId();await stop();await api('mastering_create_version',{project_id:context.project_id,base_revision:context.base_revision,request_id:request,song_id:context.song_id,parent_version_id:context.version_id,label:`${versionOf(state)?.label??'Version'} · ${parameter.name}`,effects});patch({versionId:request});await reload();await navigate('chain');
}
async function stop(){clearTimeout(previewTimer);await previewPromise.catch(()=>{});if(isActive(state)){const result=await api('playback_stop',{playback_id:state.playback.playback_id});patch({playback:result,audition:null,auditionBaseline:null,dialDrafts:Object.fromEntries(Object.entries(state.dialDrafts??{}).map(([key,draft])=>[key,{...draft,previewed:false}]))});}}
async function play(selection={}){
 const intent=transportIntent;
 if(state.playback?.state==='playing'&&!Object.keys(selection).length){patch({playback:await api('playback_pause',{playback_id:state.playback.playback_id})});return;}
 if(state.playback?.state==='paused'&&!Object.keys(selection).length){patch({playback:await api('playback_resume',{playback_id:state.playback.playback_id})});return;}
 await stop();if(intent!==transportIntent)return;const args={...target(),...selection,start_frame:startFrame(state.position,duration()),monitor_gain_db:state.monitorGain??0,output_device:host.outputDevice()||undefined};if(selection.comparison)delete args.version_id;const result=await api('playback_start',args);if(intent!==transportIntent){patch({playback:await api('playback_stop',{playback_id:result.playback_id})});return;}patch({playback:result,position:result.start_frame??state.position,activeSlot:selection.comparison?.toUpperCase()??null,auditionRevision:selection.revision});
}
async function seek(frame){
 const position=String(Math.max(0,Math.min(duration(),Number(frame))));patch({position});
 const id=state.playback?.playback_id;
 seekQueue=seekQueue.catch(()=>{}).then(async()=>{if(isActive(state)&&state.playback.playback_id===id&&state.position===position){const result=await api('playback_seek',{playback_id:id,frame:position});if(state.playback?.playback_id===id)patch({playback:result});}});
 await seekQueue;
}
async function apply(operations){await api('project_apply',{...editArgs(),operations});await reload();}
function schedulePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(()=>{previewPromise=previewPromise.then(previewDrafts).catch(error);},100);}
async function previewDrafts(){
 const playback=state.playback;if(!playback||!['playing','paused'].includes(playback.state))return;
 const entries=Object.entries(state.dialDrafts??{}).filter(([,draft])=>!draft.previewed&&draft.target.project_id===playback.project_id&&(draft.target.kind!=='mastering'||draft.target.song_id===playback.song_id&&draft.target.version_id===playback.version_id));
 if(!entries.length)return;
 const changes=entries.map(([,draft])=>({...draft.values,...(draft.target.kind==='mastering'?{track_id:draft.target.song_id}:draft.target.kind==='track'?{track_id:draft.target.track_id}:{bus_id:draft.target.bus_id})}));
 const result=await api('playback_set_mix',{playback_id:playback.playback_id,changes});if(state.playback?.playback_id!==playback.playback_id)return;
 const drafts={...state.dialDrafts};for(const [key,draft]of entries)if(JSON.stringify(drafts[key]?.values)===JSON.stringify(draft.values))drafts[key]={...draft,previewed:true};patch({playback:result,dialDrafts:drafts});
}
async function commitParameters(){
 const target=encoderTarget(state),draft=state.dialDrafts?.[target?.key];if(!draft)return;
 if(draft.target.base_revision!==state.document.revision)throw new Error('保存後に作品が変更されています。「調整を破棄」で最新値に戻してから調整してください。');
 const wasPlaying=state.playback?.state==='playing',wasPaused=state.playback?.state==='paused',position=state.position,request=requestId(),intent=transportIntent;await stop();
 const args={project_id:draft.target.project_id,base_revision:draft.target.base_revision,request_id:request};
 if(target.kind==='mastering')await api('mastering_create_version',{...args,song_id:target.song_id,parent_version_id:target.version_id,label:`${versionOf(state)?.label??'Version'} · ${draft.values.gain_db.toFixed(1)} dB`,input_gain_db:draft.values.gain_db});
 else await api('project_apply',{...args,operations:[{op:target.kind==='track'?'set_track':'set_bus',[target.kind==='track'?'track_id':'bus_id']:target.track_id??target.bus_id,changes:draft.values}]});
 const drafts={...state.dialDrafts};delete drafts[target.key];patch({dialDrafts:drafts,...(target.kind==='mastering'?{versionId:request}:{}),position});await reload();
 if(intent===transportIntent&&(wasPlaying||wasPaused)){await play();if(wasPaused&&intent===transportIntent){await readyPlayback();patch({playback:await api('playback_pause',{playback_id:state.playback.playback_id})});}}
}
async function discardParameters(){
 const target=encoderTarget(state);if(!target)return;clearTimeout(previewTimer);await previewPromise.catch(()=>{});await reload();
 const current=encoderTarget(state),drafts={...state.dialDrafts};delete drafts[target.key];patch({dialDrafts:drafts});
 if(current&&state.playback&&['playing','paused'].includes(state.playback.state)&&current.project_id===state.playback.project_id&&(current.kind!=='mastering'||current.song_id===state.playback.song_id&&current.version_id===state.playback.version_id)){
  const change=current.kind==='mastering'?{track_id:current.song_id,gain_db:current.gain_db}:{[current.kind==='track'?'track_id':'bus_id']:current.track_id??current.bus_id,gain_db:current.gain_db,pan:current.pan};patch({playback:await api('playback_set_mix',{playback_id:state.playback.playback_id,changes:[change]})});
 }
}
async function selectRelative(kind,delta){
 if(kind==='revision'){
  const selected=state.history.findIndex(item=>item.revision===Number(state.versionId)),offset=selected>=0?(state.historyOffset??0)+selected:state.historySelectionOffset??0,at=Math.max(0,Math.min(state.historyTotal-1,offset+delta));
  const result=await api('project_history',{project_id:state.projectId,offset:at,limit:1}),entry=result.entries?.[0];if(entry)patch({versionId:entry.revision,historySelectionOffset:at});return;
 }
 const selection=kind==='version'?{items:versionsOf(state),selected:state.versionId}:encoderSelection({...state,mode:kind==='project'?'library':kind==='song'?'songs':kind==='track'?'tracks':state.mode});
 const idOf=item=>item.id??item.project_id,at=selection.items.findIndex(item=>idOf(item)===selection.selected),next=selection.items[Math.max(0,Math.min(selection.items.length-1,at<0?0:at+delta))];if(!next)return;
 if(kind==='project'){await chooseProject(idOf(next));return;}
 if(kind==='song'){await stop();patch({songId:next.id,versionId:next.current_version_id,position:'0',playback:null,activeSlot:null});return;}
 patch(kind==='version'?{versionId:next.id}:{trackId:next.id});
}
async function readyPlayback(){
 const playbackId=state.playback?.playback_id,until=Date.now()+120000;
 while(Date.now()<until){
  if(state.playback?.playback_id!==playbackId||!isActive(state))throw new Error('試聴の開始が中止されました');
  const status=await api('playback_status',{playback_id:playbackId});
  if(!acceptsStatus(state,status))throw new Error('再生対象が変わりました');
  patch({playback:status});if(['playing','paused'].includes(status.state))return status;
  if(!isActive(state))throw new Error(status.error??'音声を開始できませんでした');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error('音源の準備が完了しません。停止して状態を確認してください。');
}
async function toggleMix(kind){
 const track=pageItems({...state,mode:'routing'}).find(t=>t.id===state.trackId);if(!track||track.id==='__master')return;
 if(kind==='audition'){
  if(!isActive(state))await play();
  const status=await readyPlayback();
  const turnOff=state.audition===track.id;
  const baseline=state.auditionBaseline??structuredClone(status.effective_mix??{tracks:tracksOf(state),returns:graphOf(state).buses??[]});
  const changes=auditionChanges(baseline,turnOff?null:track.id);
  const applied=await api('playback_set_mix',{playback_id:state.playback.playback_id,changes});patch({audition:turnOff?null:track.id,auditionBaseline:turnOff?null:baseline,playback:applied});return;
 }
 if(!isActive(state))await play();
 const status=await readyPlayback(),runtime=(status.effective_mix?.tracks??[]).find(t=>t.track_id===track.id||t.id===track.id)??(status.effective_mix?.returns??[]).find(t=>t.bus_id===track.id||t.id===track.id)??track;
 const result=await api('playback_set_mix',{playback_id:status.playback_id,changes:[{[track.instrument?'track_id':'bus_id']:track.id,[kind]:!runtime[kind]}]});
 patch({playback:result});

}
async function createProject(){const data=await form('新規プロジェクト',[{name:'kind',label:'種類',options:[{value:'composition',label:'曲の制作'},{value:'mastering',label:'アルバムのマスタリング'},{value:'separation',label:'ステム分離'}]},{name:'name',label:'曲名 / アルバム名',required:true}], '作成');if(!data)return;const id=requestId();const created=await api('project_create',{project_id:id,name:data.name,kind:data.kind,bpm:120,length_ticks:15360,meter:[4,4]});await refresh();await chooseProject(id);await navigate('listen');if(created.tip)host.showTip?.(created.tip);if(data.kind==='separation')await host.openSeparation?.();}
async function openFile(){const path=await host.chooseFile('project');if(!path)return;const id=requestId();await api('project_open',{project_id:id,path});await refresh();await chooseProject(id);await navigate('listen');}
async function addSong(){const path=await host.chooseFile('audio');if(!path)return;const data=await form('アルバムに曲を追加',[{name:'name',label:'曲名',value:path.split(/[\\/]/).pop().replace(/\.[^.]+$/,''),required:true}],'原音を取り込む','原音として保存し、この曲専用のステレオチェーンを作成します。');if(!data)return;await stop();const asset=await api('asset_import',{project_id:state.projectId,path,role:'source'});const assetId=asset.asset_id??asset.id??asset.asset?.id;if(!assetId)throw new Error('取り込んだ原音のIDが取得できません');const songId=requestId();await api('mastering_add_song',{...editArgs(),song_id:songId,name:data.name,asset_id:assetId,effects:[]});patch({songId,versionId:null});await reload();}
async function assign(slot){if(!state.versionId)return;await stop();await apply([{op:'set_comparison',song_id:state.songId,slot,selection:{kind:'version',version_id:state.versionId}}]);}
async function switchSlot(slot){const selection=songOf(state)?.comparison?.[slot];if(!selection)return;const position=state.position,intent=transportIntent;await stop();if(intent!==transportIntent)return;patch({position});const options=selection.kind==='version'?{version_id:selection.version_id}:{comparison:slot};await play(options);if(intent===transportIntent)patch({activeSlot:slot.toUpperCase()});}
async function acceptVersion(){await stop();await apply([{op:'set_accepted_version',song_id:state.songId,version_id:versionOf(state).id}]);}
async function editVersion(){
 const old=versionOf(state);if(!old)return;
 const context={...editArgs(),song_id:state.songId,parent_version_id:old.id};
 await stop();
 const catalog=await api('catalog_search',{query:'',limit:50,instrument_only:false});const plugins=(catalog.plugins??[]).filter(p=>!p.instrument);
 const parameterLists=[];
 for(const fx of old.effects??[])parameterLists.push(await inspectAllParameters(fx));
 const fields=[{name:'label',label:'新しい版の名前',value:`${old.label??'Version'} 編集`,required:true},{name:'gain',label:'入力ゲイン (dB)',type:'number',min:-96,max:12,step:0.1,value:old.input_gain_db??0}];
 for(const [i,fx] of (old.effects??[]).entries()){
  fields.push({name:`keep_${i}`,label:`${i+1}. ${fx.plugin_id}`,options:[{value:'yes',label:'使用する'},{value:'no',label:'この版から外す'}],value:'yes'});
  fields.push({name:`order_${i}`,label:'処理順',type:'number',min:1,max:16,step:1,value:i+1});
  for(const p of parameterLists[i])fields.push({name:`fx_${i}_${p.id}`,label:`${p.name??p.id} (0–1)`,type:'number',min:0,max:1,step:0.001,value:p.value});
 }
 fields.push({name:'add',label:'末尾にエフェクトを追加',options:[{value:'',label:'追加しない'},...plugins.map(p=>({value:p.plugin_id,label:p.name??p.plugin_id}))]});
 const data=await form('ステレオチェーン · 新しい版',fields,'保存して新しい版を作る','保存済みの版は保持されます。各エフェクトは表示順に一度ずつ処理します。');if(!data)return;
 const effects=(old.effects??[]).map((fx,i)=>({fx,i})).filter(({i})=>data[`keep_${i}`]!=='no').sort((a,b)=>Number(data[`order_${a.i}`])-Number(data[`order_${b.i}`])).map(({fx,i})=>({...fx,parameters:[...(fx.parameters??[]).filter(p=>!parameterLists[i].some(item=>item.id===p.id)),...parameterLists[i].map(p=>({id:p.id,value:Number(data[`fx_${i}_${p.id}`])}))]}));
 if(data.add)effects.push({kind:'plugin',plugin_id:data.add,parameters:[]});
 if(context.project_id!==state.projectId||context.song_id!==state.songId||context.base_revision!==state.document.revision)throw new Error('編集中に選択対象が変わりました。編集画面を開き直してください。');
 await stop();const result=await api('mastering_create_version',{...context,label:data.label,effects,input_gain_db:Number(data.gain)});patch({versionId:result.version_id??context.request_id});await reload();
}
async function editRouting(){
 const item=pageItems({...state,mode:'routing'}).find(t=>t.id===state.trackId);if(!item||item.id==='__master')return;
 const fields=[{name:'gain',label:'ゲイン (dB)',type:'number',min:-96,max:12,step:0.1,value:item.gain_db},{name:'pan',label:'パン (−1 左 / 1 右)',type:'number',min:-1,max:1,step:0.01,value:item.pan},{name:'master',label:'Masterへ出力',options:[{value:'yes',label:'出力する'},{value:'no',label:'出力しない'}],value:item.to_master?'yes':'no'}];
 for(const [i,s] of (item.sends??[]).entries())fields.push({name:`send_${i}`,label:`Send → ${(graphOf(state).buses??[]).find(b=>b.id===s.bus_id)?.name??s.bus_id} (dB)`,type:'number',min:-96,max:12,step:0.1,value:s.gain_db});
 if(!item.instrument)fields.splice(2,1);
 const values=await form(item.name,fields,'保存');if(!values)return;await stop();const changes={gain_db:Number(values.gain),pan:Number(values.pan),...(item.instrument?{to_master:values.master==='yes',sends:(item.sends??[]).map((s,i)=>({...s,gain_db:Number(values[`send_${i}`])}))}:{})};await apply([{op:item.instrument?'set_track':'set_bus',[item.instrument?'track_id':'bus_id']:item.id,changes}]);
}
async function beginExport(){
 const data=await form('書き出し内容',[],'この内容で書き出す',exportSummary());if(!data)return;
 const args={project_id:state.projectId,scope:isMastering(state)?state.exportScope:'project',formats:state.formats,revision:state.document.revision,request_id:requestId()};if(isMastering(state)&&state.exportScope!=='album'){args.song_id=state.songId;args.version_id=versionOf(state)?.id;}
 const job=await api('export_start',args);patch({jobs:[job,...state.jobs],jobId:job.job_id??job.id});await navigate('jobs');
}
async function save(){const result=await api('project_save',{project_id:state.projectId,include_audio:true});patch({lastOutput:result.output});const copied=await host.saveOutput(result.output);if(copied)patch({lastOutput:copied.output});}
async function pollJobs(){for(const item of [...state.jobs]){const id=item.job_id??item.id;if(!id)continue;try{const job=await api('job_status',{job_id:id});const output=job.output??job.files?.find(f=>f.output||f.path)?.output??job.files?.find(f=>f.path)?.path;patch({jobs:state.jobs.map(j=>(j.job_id??j.id)===id?{...job,job_id:id}:j),...(output?{lastOutput:output}:{})});}catch(e){error(e);}}}
async function select(itemId){switch(state.mode){case 'library':await chooseProject(itemId);await navigate('listen');break;case 'songlist':case 'songs':if(itemId==='__add_song')await addSong();else{await stop();const song=songsOf(state).find(s=>s.id===itemId);patch({songId:itemId,versionId:song.current_version_id,position:'0',playback:null,activeSlot:null});await navigate('listen');}break;case 'tracklist':patch({trackId:itemId});await navigate('tracks');break;case 'routelist':patch({trackId:itemId});await navigate('routing');break;case 'tracks':case 'routing':patch({trackId:itemId});break;case 'versionlist':patch({versionId:itemId});await navigate('history');break;case 'revisionlist':patch({versionId:itemId,historySelectionOffset:(state.historyOffset??0)+Math.max(0,state.history.findIndex(item=>item.revision===Number(itemId)))});await navigate('history');break;case 'history':patch({versionId:itemId});break;case 'fxparameters':patch({fxParameterId:itemId});await navigate('fxedit');break;case 'jobs':patch({jobId:itemId});break;}}
async function dispatch(command){
 if(!command)return;
 if(command.type==='stop'){transportIntent++;try{await stop();}catch(e){error(e);}return;}
 if(command.type==='monitorVolume'||command.type==='monitorMute'){
  const gain=command.type==='monitorMute'?(state.monitorGain<=-96?state.unmutedGain??0:-96):Math.max(-96,Math.min(0,(state.monitorGain??0)+command.delta));
  patch({unmutedGain:gain<=-96?state.monitorGain:gain,monitorGain:gain});
  const id=state.playback?.playback_id;
  volumeQueue=volumeQueue.catch(()=>{}).then(async()=>{if(isActive(state)&&state.playback.playback_id===id&&state.monitorGain===gain)await api('playback_set_volume',{playback_id:id,gain_db:gain});});
  try{await volumeQueue;}catch(e){error(e);}return;
 }
 if(['seekBy','seekToRatio','back5','forward5','home'].includes(command.type)){
  const frame=command.type==='home'?0:command.type==='seekToRatio'?duration()*command.ratio:Number(state.position)+(command.type==='seekBy'?command.frames:command.type==='back5'?-240000:240000);
  try{await seek(frame);}catch(e){error(e);}return;
 }
 if(command.type==='selectRelative'&&['track','version'].includes(command.target)){try{await selectRelative(command.target,command.delta);}catch(e){error(e);}return;}
 if(['adjustParameter','resetParameter','adjustFxParameter'].includes(command.type)){
  if(pending||state.busy)return;
  if(command.type==='adjustFxParameter'){const p=state.fxParameters?.find(p=>p.id===state.fxParameterId);if(p)patch({fxParameterValues:{...state.fxParameterValues,[p.id]:Math.max(0,Math.min(1,(state.fxParameterValues?.[p.id]??p.value)+command.delta))}});return;}
  state=adjustEncoderDraft(state,command.parameter,command.delta??0,command.type==='resetParameter');render();schedulePreview();return;
 }
 const navigation=['navigate','page','back'].includes(command.type);
 if(pending&&!navigation&&command.type!=='stop')return;
 if(!navigation){pending=true;patch({busy:true});host.clearMessage();}
 try{
  if(command.type==='navigate')await navigate(command.mode);
  else if(command.type==='page'){state=reduceDeckState(state,command);if(state.mode==='revisionlist')await loadHistory();render();}
  else if(command.type==='back'){state=reduceDeckState(state,command);render();}
  else if(command.type==='select')await select(command.itemId);
  else if(command.type.startsWith('format:')){const f=command.type.split(':')[1];patch({formats:state.formats.includes(f)?state.formats.filter(x=>x!==f):[...state.formats,f]});}
  else switch(command.type){
   case 'openSelected':await navigate('listen');break;
   case 'openWorkspace':{const id=await host.chooseProjectFolder();if(id)await chooseProject(id);break;}
   case 'separation':await host.openSeparation?.();break;case 'create':await createProject();break;case 'openFile':await openFile();break;case 'refresh':await refresh();if(state.projectId)await reload();break;
   case 'addSong':await addSong();break;
   case 'listenSong':await selectRelative('song',command.delta);await play();break;
   case 'seekBy':await seek(Number(state.position)+command.frames);break;case 'seekToRatio':await seek(Math.round(duration()*command.ratio));break;
   case 'selectRelative':await selectRelative(command.target,command.delta);break;case 'openEncoderSelection':await navigate(command.mode);break;
   case 'commitParameters':await commitParameters();break;case 'discardParameters':await discardParameters();break;case 'commitFxParameter':await commitFxParameter();break;
   case 'playSelectedVersion':await play({version_id:versionOf(state)?.id});break;
   case 'play':await play();break;case 'stop':await stop();break;case 'back5':await seek(Number(state.position)-240000);break;case 'forward5':await seek(Number(state.position)+240000);break;case 'home':await seek(0);break;
   case 'mute':case 'solo':case 'audition':await toggleMix(command.type);break;
   case 'switchA':await switchSlot('a');break;case 'switchB':await switchSlot('b');break;case 'assignA':await assign('a');break;case 'assignB':await assign('b');break;
   case 'acceptVersion':await acceptVersion();break;case 'editVersion':await editVersion();break;case 'editRouting':await editRouting();break;
   case 'exportSong':patch({exportScope:'song'});await navigate('export');break;case 'exportAlbum':patch({exportScope:'album'});await navigate('export');break;case 'toggleScope':patch({exportScope:state.exportScope==='album'?'song':'album'});break;
   case 'export':await beginExport();break;case 'reviewExport':await form('書き出し内容',[],'閉じる',exportSummary());break;case 'save':await save();break;
   case 'midi':{const result=await api('export_midi',{project_id:state.projectId});patch({lastOutput:result.output});await host.saveOutput(result.output);break;}
   case 'reveal':await host.reveal(state.lastOutput);break;
   case 'output':host.openSettings();break;
   case 'dataDir':{const result=await host.chooseDataDir();if(result){state=createDeckState();await bootstrap();}break;}
   case 'restore':await stop();await api('project_restore',{...editArgs(),revision:Number(state.versionId)});await reload();await loadHistory();break;
   case 'playRevision':await play({revision:Number(state.versionId)});break;
   case 'cancelJob':await api('job_cancel',{job_id:state.jobId});await pollJobs();break;case 'pollJobs':case 'jobDetails':await pollJobs();break;
  }
 }catch(e){error(e);}finally{await contextQueue;if(!navigation){pending=false;patch({busy:false});}}
}
async function poll(){if(disposed)return;try{
 if(!pending&&Date.now()-contextPollAt>2000){contextPollAt=Date.now();await refresh();if(state.projectId)await reload();}
if(state.playback){const status=await api('playback_status',{playback_id:state.playback.playback_id});if(acceptsStatus(state,status)){patch({playback:status,position:status.position_frame??state.position});if(status.state==='playing')schedulePreview();}}if(state.jobs.some(j=>['queued','running','starting'].includes(j.state)))await pollJobs();}catch(e){error(e);}if(!disposed)pollTimer=setTimeout(poll,400);}
async function bootstrap(){
 const data=await application.bootstrap(),preferences=await host.preferences();
 state.customLayouts=preferences.customLayouts??{};state.encoderAssignments=preferences.encoderAssignments??{};state.api=data.api??[];
 await host.configure(data,preferences);
 const projects=Array.isArray(data.projects)?data.projects:data.projects?.projects??[];patch({projects});
 const context=state.api.includes('active_context_get')?await api('active_context_get'):null;
 const selected=projects.find(p=>p.project_id===(context?.project_id??preferences.project_id));
 if(selected){await chooseProject(selected.project_id);if(context?.project_id===selected.project_id&&context.song_id)patch({songId:context.song_id,versionId:context.version_id,activeSlot:context.comparison?.toUpperCase()??null});}render();
}
function snapshot(){return createSurfaceSnapshot(state,{sequence,artworkUrl,waveform,overlay,bootstrapping,duration:duration()});}
async function surfaceDispatch(action){
 if(disposed)return {status:'unavailable'};
 const resolved=resolveSurfaceAction(state,action,duration());if(!resolved)return {status:'invalid'};
 if(resolved.settings){host.openSettings();return {status:'accepted'};}
 if(resolved.unavailable)return {status:'unavailable'};
 const beforeErrors=errorSequence;await dispatch(resolved.command);
 if(errorSequence!==beforeErrors)return {status:'failed'};
 if(action.type==='control.encoder'){const item=buildEncoders(state)[action.index];overlay={title:item.title,value:item.value};clearTimeout(overlayTimer);render();overlayTimer=setTimeout(()=>{overlay=null;render();},1200);}
 return {status:'accepted'};
}
return {
 getState:()=>state,snapshot,dispatch,dispatchAction:surfaceDispatch,patch,chooseProject,
 subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},
 async start(){if(disposed)return;patch({busy:true});try{await bootstrap();bootstrapping=false;patch({busy:false});void poll();}catch(e){bootstrapping=false;patch({busy:false});error(e);}},
 dispose(){disposed=true;clearTimeout(pollTimer);clearTimeout(previewTimer);clearTimeout(overlayTimer);listeners.clear();}
};
}
