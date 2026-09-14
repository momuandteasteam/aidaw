import {openSeparationProgress} from './separation-progress.mjs';
import {setupVersions} from './versions.mjs';
import {setupMasteringDownload} from './mastering-download.mjs';
import {setupAudioSettings} from './audio-settings.mjs';
import {setupSeparation} from './separation.mjs';
import {setupTopBar} from './top-bar.mjs';
import {createControlRuntime} from '../runtime/control-runtime.mjs';
import {createSkinHost} from '../../../../Plugins/Skins/index.mjs';
import {setupLayoutSettings} from './layout-settings.mjs';
import {isActive} from '../../ControlSurface/model.mjs';
const $=id=>document.getElementById(id);
const bridge=window.aidaw;
const versionsUI=setupVersions(bridge);
const masteringDownload=setupMasteringDownload(bridge);
const audioSettings=setupAudioSettings({select:$('device'),dialog:$('settingsDialog'),status:$('audioDeviceStatus'),bridge});
let state,dialogResolve,layoutSettingsReady=false,skinHost;
const error=e=>{$('message').textContent=e?.message??String(e);};

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
const host={
 ...bridge,form,separationProgress:openSeparationProgress,notify:text=>{$('message').textContent=text;},downloadMastering:(args,label,onConfirm,name)=>masteringDownload.open(args,label,onConfirm,name),openSeparation:()=>separationUI.open(),showTip:text=>{$('message').textContent=`Tip: ${text}`;},outputDevice:()=>$('device').value,clearMessage:()=>{$('message').textContent='';},
 openSettings(){ $('settingsDialog').showModal(); },
 async configure(data,preferences){
  if(!layoutSettingsReady){setupLayoutSettings({getState:()=>runtime.getState(),setLayouts:customLayouts=>runtime.patch({customLayouts}),setEncoders:encoderAssignments=>runtime.patch({encoderAssignments}),initial:preferences.customLayouts??{},initialEncoders:preferences.encoderAssignments??{}});layoutSettingsReady=true;}
  audioSettings.configure(data.devices,preferences);
  const skin=skinHost.list().some(s=>s.id===preferences.skin)?preferences.skin:'deck';skinHost.select(skin);
 }
};
const runtime=createControlRuntime({application:{invoke:(name,args)=>bridge.api(name,args),bootstrap:()=>bridge.bootstrap()},host,onError:error});
const separationUI=setupSeparation({bridge,getState:()=>runtime.getState(),reload:()=>runtime.dispatch({type:'refresh'}),stop:()=>runtime.dispatch({type:'stop'})});
state=runtime.getState();
skinHost=createSkinHost({root:$('surfaceRoot'),runtime});
skinHost.select('deck');
const topBar=setupTopBar({getState:()=>runtime.getState(),dispatch:runtime.dispatch,dispatchAction:runtime.dispatchAction,chooseProject:runtime.chooseProject,onError:error});
const unsubscribe=runtime.subscribe(()=>{state=runtime.getState();topBar.update();$('device').disabled=isActive(state);});
window.addEventListener('keydown',event=>{if(event.defaultPrevented||event.target.closest('input,select,button,textarea')||event.altKey||event.ctrlKey||event.metaKey||event.repeat||document.querySelector('dialog[open]'))return;const action=event.code==='Space'?{type:'transport.playPause'}:event.code==='Escape'?{type:'transport.stop'}:['ArrowLeft','ArrowRight'].includes(event.code)?{type:'transport.seekRelative',seconds:event.code==='ArrowLeft'?-5:5}:null;if(action){event.preventDefault();void runtime.dispatchAction(action);}});
let closeReady=false;
window.addEventListener('beforeunload',event=>{
 if(!closeReady){event.preventDefault();event.returnValue=false;void runtime.flushMix().then(()=>{closeReady=true;window.close();}).catch(error);return;}
 versionsUI.dispose();masteringDownload.dispose();audioSettings.dispose();unsubscribe();topBar.dispose();skinHost.dispose();runtime.dispose();
});
void runtime.start();
