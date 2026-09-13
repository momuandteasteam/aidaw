// Real Chromium DOM check; launched by surface-browser.test.mjs.
const {app,BrowserWindow}=require('electron');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{await app.whenReady();const win=new BrowserWindow({show:false,width:480,height:600,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 await win.loadURL('file://'+path.join(__dirname,'surface-fixture.html'));
 const base=pathToFileURL(path.join(__dirname,'../Source/Desktop')).href;
 const result=await win.webContents.executeJavaScript(`(async()=>{
 const {createControlRuntime}=await import(${JSON.stringify(base)}+'/runtime/control-runtime.mjs');
 const {createSkinHost}=await import(${JSON.stringify(pathToFileURL(path.join(__dirname,'../../Plugins/Skins')).href)}+'/index.mjs');
 const calls=[],errors=[];const runtime=createControlRuntime({application:{async invoke(name,args){calls.push({name,args});return {playback_id:'session',project_id:'song',state:name==='playback_pause'?'paused':'playing'};}},host:{outputDevice:()=>'',clearMessage(){},openSettings(){}},onError:e=>errors.push(String(e))});
 runtime.patch({projectId:'song',document:{schema_version:3,id:'song',kind:'composition',revision:1,name:'Skin check',composition:{bpm:120,length_ticks:3840,tracks:[],buses:[],master_effects:[]}},playback:{playback_id:'session',project_id:'song',state:'playing'},position:'100'});
 const root=document.createElement('section');root.id='surfaceRoot';document.body.append(root);const host=createSkinHost({root,runtime});host.select('deck');
 const deckCount=root.querySelectorAll('.key').length,knobs=root.querySelectorAll('.encoder-knob').length;
 const visibleKeys=[...root.querySelectorAll('.key:not([hidden])')].map(b=>({index:Number(b.dataset.index),column:b.style.gridColumn}));
 const disabledHidden=[...root.querySelectorAll('.key:disabled')].every(b=>!b.hidden),emptyKnobs=root.querySelector('.encoder-knobs').hidden;
 const kindInitial=root.querySelector('.project-kind').textContent;const tempoInitial=root.querySelector('.tempo').textContent;const saved=runtime.getState();runtime.patch({document:null,playback:null});const emptyDeck=root.querySelector('.deck').hidden,emptyPanel=root.querySelector('.encoder-panel').hidden;
 const kindEmpty=root.querySelector('.project-kind').hidden;const tempoEmpty=root.querySelector('.tempo').hidden;runtime.patch({document:{kind:'separation',name:'Stem'}});const kindSeparation=root.querySelector('.project-kind').textContent;runtime.patch({document:{kind:'mastering',name:'Album',mastering:{songs:[]}}});const kindMastering=root.querySelector('.project-kind').textContent;runtime.patch({...saved,document:{...saved.document,composition:{...saved.document.composition,bpm:98.5}}});const tempoUpdated=root.querySelector('.tempo').textContent;
 runtime.patch({...saved,encoderAssignments:{composition:{3:{rotate:'volume',press:'none'}}}});
 const visibleCells=[...root.querySelectorAll('.encoder-cell:not([hidden])')].map(c=>c.style.gridColumn);

 host.select('transport');const tempoTransport=root.querySelector('.tempo').textContent;const minimalCount=root.querySelectorAll('.transport-button').length;
 root.querySelector('[aria-label="5秒戻る"]').click();await new Promise(r=>setTimeout(r,10));
 const volume=root.querySelector('input');volume.value='-18';volume.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,10));
 const sameSession=runtime.snapshot().transport.id==='session';host.select('deck');const deckAgain=root.querySelectorAll('.key').length;host.dispose();const remaining=root.children.length;runtime.dispose();return {kindInitial,kindEmpty,kindSeparation,kindMastering,tempoInitial,tempoEmpty,tempoUpdated,tempoTransport,deckCount,knobs,minimalCount,sameSession,deckAgain,remaining,calls,errors,visibleKeys,disabledHidden,emptyKnobs,emptyDeck,emptyPanel,visibleCells};
})()`);
 console.log('SURFACE_RESULT '+JSON.stringify(result));win.destroy();app.quit();})().catch(e=>{console.error(e);app.exit(1);});
