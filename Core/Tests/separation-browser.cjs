const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {pathToFileURL}=require('node:url');const path=require('node:path');
(async()=>{await app.whenReady();const win=new BrowserWindow({show:false,width:540,height:700,webPreferences:{contextIsolation:true,nodeIntegration:false}});await win.loadFile(path.join(__dirname,'surface-fixture.html'));
const root=path.resolve(__dirname,'../..'),base=pathToFileURL(root+'/').href,html=readFileSync(path.join(root,'Core/Source/Desktop/renderer/index.html'),'utf8');
const result=await win.webContents.executeJavaScript(`(async()=>{
 document.body.innerHTML=${JSON.stringify(html.match(/<body>([\s\S]*?)<script/)[1])};
 const link=document.createElement('link');link.rel='stylesheet';link.href=${JSON.stringify(base)}+'Core/Source/Desktop/renderer/styles.css';document.head.append(link);await new Promise(r=>link.onload=r);
 const {setupSeparation}=await import(${JSON.stringify(base)}+'Core/Source/Desktop/renderer/separation.mjs');
 const calls=[],doc={kind:'separation',name:'Stem test',revision:1,composition:{tracks:['vocals','drums','bass','other'].map(id=>({id,name:id,mute:false,solo:false}))}};let job='';
 const ui=setupSeparation({getState:()=>({projectId:'song',document:doc}),reload:async()=>{},stop:async()=>calls.push({name:'stop'}),bridge:{async chooseFile(){return '/mock/source.wav';},async saveOutput(path){calls.push({name:'saveOutput',path});},async api(name,args){calls.push({name,args});if(name==='project_document')return structuredClone(doc);if(name==='project_apply'){Object.assign(doc.composition.tracks.find(t=>t.id===args.operations[0].track_id),args.operations[0].changes);doc.revision++;return {revision:doc.revision};}if(name==='asset_import')return {id:'source'};if(name==='separation_start'||name==='separation_export'){job=name;return {job_id:'job'};}if(name==='job_status')return {state:'succeeded',files:[{path:job==='separation_export'?'/mock/stems.zip':'/mock/vocals.wav'}]};return {};}}});
 const $=id=>document.getElementById(id),tick=ms=>new Promise(r=>setTimeout(r,ms));await ui.open();const rows=$('separationStems').children.length;
 const mute=$('separationStems').querySelector('input');mute.click();await tick(50);const muteSaved=doc.composition.tracks[0].mute;
 $('separationZip').click();await tick(400);const saved=calls.some(c=>c.name==='saveOutput'&&c.path==='/mock/stems.zip');
 $('separationStart').click();await tick(50);const locked=$('separationZip').disabled;await tick(400);const started=calls.some(c=>c.name==='separation_start');
 const bounds=$('separationDialog').getBoundingClientRect();const fits=bounds.left>=0&&bounds.right<=innerWidth&&$('separationMix').getBoundingClientRect().bottom<=innerHeight;return {rows,muteSaved,saved,locked,started,fits,status:$('separationStatus').textContent};
})()`);
const dir=path.join(root,'Core/Build/ui-preview');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'separation.png'),(await win.webContents.capturePage()).toPNG());console.log('SEPARATION_UI '+JSON.stringify(result));win.destroy();app.quit();})().catch(e=>{console.error(e);app.exit(1);});
