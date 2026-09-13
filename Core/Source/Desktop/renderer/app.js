import {setupSeparation} from './separation.mjs';
import {setupTopBar} from './top-bar.mjs';
import {createControlRuntime} from '../runtime/control-runtime.mjs';
import {createSkinHost} from '../../../../Plugins/Skins/index.mjs';
import {setupLayoutSettings} from './layout-settings.mjs';
import {setupControllerSettings} from './controller-settings.mjs';
import {pageItems,songsOf,songOf,graphOf,tracksOf,versionOf,isMastering,isActive,comparisonLabel} from '../../ControlSurface/model.mjs';
const $=id=>document.getElementById(id);
const bridge=window.aidaw;
let state,dialogResolve,controllerSettings,layoutSettingsReady=false,skinHost;
const error=e=>{$('message').textContent=e?.message??String(e);};
const modeTitles={listen:'再生',library:'プロジェクト',modes:'モード選択',transport:'制作 · 通常再生',tracks:'トラック操作',tracklist:'トラックを選択',routing:'経路とFX',routelist:'経路を選択',songs:'アルバム操作',songlist:'アルバムの曲',mastering:'マスタリング · A/B',history:'履歴の操作',versionlist:'曲の版を選択',revisionlist:'保存版を選択',chain:'ステレオチェーン',export:'書き出し',settings:'設定',jobs:'ジョブ',parameters:'ゲイン / パン',fxparameters:'FXパラメーター',fxedit:'FXパラメーター編集'};
function line(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);return p;}
function form(title,fields,submitLabel='実行',description=''){
 const dialog=$('editor');$('editorTitle').textContent=title;$('editorFields').replaceChildren();$('editorError').textContent='';$('editorSubmit').textContent=submitLabel;
 if(description)line($('editorFields'),description);
 for(const field of fields){const label=document.createElement('label');label.textContent=field.label;let input;if(field.options){input=document.createElement('select');for(const option of field.options){const o=document.createElement('option');o.value=option.value;o.textContent=option.label;input.append(o);}}else{input=document.createElement(field.type==='textarea'?'textarea':'input');input.type=field.type??'text';if(field.min!==undefined)input.min=field.min;if(field.max!==undefined)input.max=field.max;if(field.step!==undefined)input.step=field.step;}input.name=field.name;input.value=field.value??'';input.required=Boolean(field.required);label.append(input);$('editorFields').append(label);}
 dialog.showModal();return new Promise(resolve=>{dialogResolve=resolve;});
}
$('editorForm').addEventListener('submit',event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.target));$('editor').close();dialogResolve?.(values);dialogResolve=null;});
function cancelForm(){ $('editor').close();dialogResolve?.(null);dialogResolve=null; }
$('editorCancel').addEventListener('click',cancelForm);$('editor').addEventListener('cancel',event=>{event.preventDefault();cancelForm();});
function renderInspector(){
 const box=$('inspector');box.replaceChildren();$('inspectorTitle').textContent=modeTitles[state.mode];
 if(state.mode==='export'){line(box,exportSummary());line(box,'書き出しは選択した版を固定して実行します。成果物はジョブから取得できます。');if(isMastering(state))line(box,'原音はステレオ2ミックスです。楽器別ステムとMIDIは生成できません。');}
 else if(state.mode==='tracks'||state.mode==='routing'){
  const item=pageItems({...state,mode:'routing'}).find(t=>t.id===state.trackId);if(item){line(box,`${item.name} · ${item.instrument?.kind==='audio'?'AUDIO':item.instrument?'MIDI':'BUS / MASTER'}`);line(box,`Gain ${item.gain_db??0} dB · Pan ${item.pan??0} · Mute ${Boolean(item.mute)} · Solo ${Boolean(item.solo)}`);if(item.instrument)line(box,`音源: ${item.instrument.plugin_id??item.instrument.asset_id??item.instrument.sound}`);for(const fx of item.effects??[])line(box,`Insert: ${fx.plugin_id}`);for(const send of item.sends??[])line(box,`Send → ${(graphOf(state).buses??[]).find(b=>b.id===send.bus_id)?.name??send.bus_id} · ${send.gain_db} dB · ${send.position} · ${send.enabled?'ON':'OFF'}`);if(item.to_master!==undefined)line(box,`Masterへの出力: ${item.to_master?'ON':'OFF'}`);}else line(box,'トラックまたは経路を選択してください。');
 }
 else if(isMastering(state)&&songOf(state)){const song=songOf(state),version=versionOf(state);line(box,`${song.name} · ${song.versions.length} 版`);line(box,`A: ${comparisonLabel(song.comparison?.a)} / B: ${comparisonLabel(song.comparison?.b)}`);line(box,`採用版: ${song.accepted_version_id??'未選択'} · 編集版: ${song.current_version_id}`);if(version){line(box,`選択版: ${version.label??version.id} (${version.id})`);line(box,`Input ${version.input_gain_db??0} dB · Source ${version.source_asset_id??'—'}`);for(const fx of version.effects??[])line(box,`→ ${fx.plugin_id} · ${fx.parameters?.length??0} parameters`);if(!version.effects?.length)line(box,'Stereo input → Stereo output（FXなし）');}}
 else if(state.mode==='jobs'){const job=state.jobs.find(j=>(j.job_id??j.id)===state.jobId);for(const j of job?[job]:state.jobs){line(box,`${j.job_id??j.id} · ${j.state}`);if(j.error)line(box,j.error);for(const f of j.files??[])line(box,`${f.format??''} ${f.output??f.path??''}`);}}
 else if(state.mode==='history') {line(box,`保存履歴 ${state.historyTotal} 件 · 選択 R${state.versionId??'—'}`);}
 else if(state.document){line(box,`${state.document.name} · ${isMastering(state)?`${songsOf(state).length} 曲`:`${tracksOf(state).length} トラック`}`);line(box,'MIDI、audio clip、send、return、masterは保存されたモデルの設定を使用します。');}
 else line(box,'新規作成、または保存済みの .aidaw.zip を開いて始めます。');
 if(state.lastOutput)line(box,`成果物: ${state.lastOutput}`);
}
function exportSummary(){const album=state.exportScope==='album'&&isMastering(state);return `${album?'アルバム全曲':isMastering(state)?songOf(state)?.name??'曲未選択':state.document?.name??'未選択'} · ${state.formats.join(' / ').toUpperCase()} · ${album?songsOf(state).map(s=>`${s.name}: ${s.accepted_version_id??s.current_version_id}`).join('、'):isMastering(state)?versionOf(state)?.id??'版未選択':`R${state.document?.revision??'—'}`}`;}

const host={
 ...bridge,form,openSeparation:()=>separationUI.open(),showTip:text=>{$('message').textContent=`Tip: ${text}`;},outputDevice:()=>$('device').value,clearMessage:()=>{$('message').textContent='';},
 openSettings(){ $('settingsDialog').showModal(); },
 async configure(data,preferences){
  if(!layoutSettingsReady){setupLayoutSettings({getState:()=>runtime.getState(),setLayouts:customLayouts=>runtime.patch({customLayouts}),setEncoders:encoderAssignments=>runtime.patch({encoderAssignments}),initial:preferences.customLayouts??{},initialEncoders:preferences.encoderAssignments??{}});layoutSettingsReady=true;}
  if(!controllerSettings)controllerSettings=setupControllerSettings({getState:()=>runtime.getState(),dispatch:runtime.dispatch,onError:error,preferences:preferences.controller});
  $('device').replaceChildren();const devices=data.devices.devices??data.devices.output_devices??data.devices.device_types?.flatMap(t=>t.outputs.map(name=>({name})))??[];
  for(const item of devices){const option=document.createElement('option');option.value=typeof item==='string'?item:item.name;option.textContent=option.value;$('device').append(option);}
  if(!devices.length)$('device').append(new Option('システムの既定出力',''));
  if(preferences.output_device)$('device').value=preferences.output_device;
  const skin=skinHost.list().some(s=>s.id===preferences.skin)?preferences.skin:'deck';skinHost.select(skin);$('skinSelect').value=skin;
 }
};
const runtime=createControlRuntime({application:{invoke:(name,args)=>bridge.api(name,args),bootstrap:()=>bridge.bootstrap()},host,onError:error});
const separationUI=setupSeparation({bridge,getState:()=>runtime.getState(),reload:()=>runtime.dispatch({type:'refresh'}),stop:()=>runtime.dispatch({type:'stop'})});
state=runtime.getState();
skinHost=createSkinHost({root:$('surfaceRoot'),runtime});
for(const skin of skinHost.list())$('skinSelect').add(new Option(skin.name,skin.id));
skinHost.select('deck');
$('skinSelect').addEventListener('change',()=>{try{skinHost.select($('skinSelect').value);void bridge.saveSkinPreferences(skinHost.selected).catch(error);}catch(e){$('skinSelect').value=skinHost.selected??'deck';error(e);}});
const topBar=setupTopBar({getState:()=>runtime.getState(),dispatch:runtime.dispatch,dispatchAction:runtime.dispatchAction,chooseProject:runtime.chooseProject,onError:error});
const unsubscribe=runtime.subscribe(()=>{state=runtime.getState();topBar.update();$('device').disabled=isActive(state);$('latency').textContent=`LATENCY ${state.playback?.processing_latency_samples??'—'}`;$('xruns').textContent=`XRUN ${state.playback?.xruns??'—'}`;renderInspector();});
$('device').addEventListener('change',()=>void bridge.saveAudioPreferences($('device').value).catch(error));
window.addEventListener('keydown',event=>{if(event.defaultPrevented||event.target.closest('input,select,button,textarea')||event.altKey||event.ctrlKey||event.metaKey||event.repeat||document.querySelector('dialog[open]'))return;const action=event.code==='Space'?{type:'transport.playPause'}:event.code==='Escape'?{type:'transport.stop'}:['ArrowLeft','ArrowRight'].includes(event.code)?{type:'transport.seekRelative',seconds:event.code==='ArrowLeft'?-5:5}:null;if(action){event.preventDefault();void runtime.dispatchAction(action);}});
window.addEventListener('beforeunload',()=>{unsubscribe();topBar.dispose();skinHost.dispose();controllerSettings?.dispose();runtime.dispose();});
void runtime.start();
