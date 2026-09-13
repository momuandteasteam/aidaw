import {applyCustomLayout,stopOrHomeAction} from './layout-customization.mjs';
import {getDesktopKeyOrder} from './key-image.mjs';
export function startFrame(position, duration) {
  const frame = Math.max(0, Math.floor(Number(position) || 0));
  const end = Math.max(0, Math.floor(Number(duration) || 0));
  return String(end === 0 || frame >= end ? 0 : frame);
}

export function statusBelongsToProject(status, projectId) {
  return Boolean(status && projectId && status.project_id === projectId);
}

export function projectIsPlayable(project) {
  return Boolean(project && project.playable && Number(project.track_count) > 0);
}

export const modes = ['listen','library','modes','transport','tracks','routing','songs','mastering','history','chain','export','settings','jobs','tracklist','routelist','songlist','versionlist','revisionlist','parameters','fxparameters','fxedit'];
export const terminalStates = new Set(['stopped','completed','failed','cancelled']);
export function createDeckState() {
  return { mode:'listen', page:0, stack:[], projects:[], document:null, projectId:null, songId:null, trackId:null, versionId:null, playback:null, position:'0', busy:false, query:'', formats:['wav'], exportScope:'song', jobs:[], api:[], history:[], historyTotal:0 };
}
export function songsOf(s) { const album=s.document?.mastering, songs=album?.songs??s.document?.songs??[];return album?.song_order?album.song_order.map(id=>songs.find(song=>song.id===id)).filter(Boolean):songs; }
export function songOf(s) { return songsOf(s).find(song => song.id === s.songId); }
export function graphOf(s) { return s.document?.composition?.graph ?? s.document?.composition ?? s.document?.graph ?? s.document ?? {}; }
export function tracksOf(s) { return graphOf(s).tracks ?? []; }
export function versionsOf(s) { return [...(songOf(s)?.versions ?? [])].reverse(); }
export function versionOf(s) { const song = songOf(s); return song?.versions?.find(v => v.id === (s.versionId ?? song.current_version_id)); }
export function isMastering(s) { return s.document?.kind === 'mastering'; }
export function isActive(s) { return Boolean(s.playback && !terminalStates.has(s.playback.state)); }
export function acceptsStatus(s, status) {
  return Boolean(status && s.playback && status.playback_id === s.playback.playback_id && status.project_id === s.projectId && (!status.song_id || status.song_id === s.songId));
}
export function pageItems(s) {
  if (s.mode === 'library') return s.projects.filter(p => `${p.name} ${p.project_id}`.toLocaleLowerCase().includes(s.query.toLocaleLowerCase()));
  if (s.mode === 'tracks'||s.mode==='tracklist') return tracksOf(s);
  if (s.mode === 'routing'||s.mode==='routelist') return [...tracksOf(s), ...(graphOf(s).buses ?? []), ...(s.document ? [{id:'__master',name:'MASTER',effects:graphOf(s).master_effects ?? []}] : [])];
  if (s.mode === 'songs'||s.mode==='songlist') return [...songsOf(s), {id:'__add_song',name:'曲を追加'}];
  if (s.mode === 'versionlist'||s.mode==='revisionlist'||s.mode === 'history') return isMastering(s) ? versionsOf(s) : s.history;
  if (s.mode === 'chain') return versionOf(s)?.effects ?? [];
  if (s.mode === 'jobs') return s.jobs;
  return [];
}
export function pageCount(s) { return Math.max(1,Math.ceil((s.mode==='revisionlist'?s.historyTotal:contextActions(s).length)/3)); }
export function reduceDeckState(s, event) {
  if (event.type === 'navigate') return {...s,mode:event.mode,page:0,stack:[...s.stack,{mode:s.mode,page:s.page}]};
  if (event.type === 'back') { const stack = [...s.stack], previous = stack.pop(); return {...s,...(previous ?? {mode:'library',page:0}),stack}; }
  if (event.type === 'page') return {...s,page:Math.max(0,Math.min(pageCount(s)-1,s.page+event.delta))};
  if (event.type === 'patch') { const next={...s,...event.patch}; next.page=Math.max(0,Math.min(pageCount(next)-1,next.page)); return next; }
  return s;
}
export function contextActions(s) {
 const out=[],has=Boolean(s.document),master=isMastering(s),song=songOf(s),track=tracksOf(s).find(t=>t.id===s.trackId),route=pageItems({...s,mode:'routing'}).find(t=>t.id===s.trackId);
 const pad=(label,command,options={})=>out.push({label,secondary:'',icon:'',pressed:false,enabled:true,disabled_reason:'対象を選択してください',busy:false,command,...options});
 const action=(label,type,options={})=>pad(label,{type},options);
 const nav=(label,mode,enabled=true)=>pad(label,{type:'navigate',mode},{enabled});
 const play=()=>action(s.playback?.state==='playing'?'一時停止':'再生','play',{icon:s.playback?.state==='playing'?'Ⅱ':'▶',enabled:master?Boolean(song):tracksOf(s).length>0});
 const mix=kind=>action({mute:'ミュート',solo:'ソロ',audition:'試聴'}[kind],kind,{enabled:Boolean(route)&&route.id!=='__master',pressed:kind==='audition'?Boolean(track)&&s.audition===track.id:Boolean((s.playback?.effective_mix?.tracks??[]).find(t=>(t.track_id??t.id)===route?.id)?.[kind]??route?.[kind]),secondary:route?.name??''});
 const selectList=(items,selected)=>{for(const item of items){const itemId=item.id??item.job_id??item.project_id??item.revision;pad(item.name??item.label??item.summary??item.plugin_id??`R${item.revision}`,{type:'select',itemId},{pressed:String(itemId)===String(selected),secondary:item.state??(item.mute?'MUTE':item.solo?'SOLO':item.created_at?.slice(0,16)??'')});}};
 switch(s.mode){
  case 'listen':play();action('先頭へ','home',{enabled:has});action('5秒戻る','back5',{enabled:has});break;
  case 'modes':nav('再生','listen',has);nav(master?'A/B比較':'トラック',master?'mastering':'tracks',has);nav('書き出し','export',has);nav('アルバムの曲','songs',master);nav('履歴','history',has);nav('プロジェクト','library');nav('設定','settings');nav('ジョブ','jobs');break;
  case 'library':action('新規作成','create');action('プロジェクトをインポート','openFile');action('一覧更新','refresh');selectList(pageItems(s),s.projectId);break;
  case 'transport':play();nav('トラック選択','tracklist');nav('書き出し','export');action('5秒戻る','back5');action('5秒進む','forward5');action('先頭へ','home');nav('トラック操作','tracks');nav('経路・FX','routing');nav('調整','parameters');break;
  case 'tracks':nav('トラック選択','tracklist');mix('mute');mix('solo');mix('audition');nav('ゲイン・パン','parameters');nav('経路・FX','routing');play();break;
  case 'tracklist':selectList(tracksOf(s),s.trackId);break;
  case 'routing':nav('経路を選択','routelist');action('詳細を編集','editRouting',{enabled:Boolean(route)&&route.id!=='__master'});nav('ゲイン・パン','parameters');mix('mute');mix('solo');play();break;
  case 'routelist':selectList(pageItems(s),s.trackId);break;
  case 'songs':nav('アルバムの曲','songlist');action('曲を追加','addSong');play();nav('曲の履歴','history',Boolean(song));nav('ステレオFX','chain',Boolean(song));action('曲を書き出す','exportSong',{enabled:Boolean(song)});action('アルバム出力','exportAlbum',{enabled:songsOf(s).length>0});break;
  case 'songlist':selectList(songsOf(s),s.songId);break;
  case 'mastering':play();action('Aへ切替','switchA',{enabled:Boolean(song?.comparison?.a),secondary:comparisonLabel(song?.comparison?.a)});action('Bへ切替','switchB',{enabled:Boolean(song?.comparison?.b),secondary:comparisonLabel(song?.comparison?.b)});nav('履歴','history');nav('ステレオFX','chain');nav('入力ゲイン','parameters');action('曲を書き出す','exportSong');nav('アルバムの曲','songlist');action('5秒戻る','back5');action('5秒進む','forward5');action('先頭へ','home');break;
  case 'history':if(master){nav('版を選択','versionlist');action('選択版をAへ','assignA',{enabled:Boolean(s.versionId)});action('選択版をBへ','assignB',{enabled:Boolean(s.versionId)});action('Aへ切替','switchA',{enabled:Boolean(song?.comparison?.a)});action('Bへ切替','switchB',{enabled:Boolean(song?.comparison?.b)});action('選択版から編集','editVersion',{enabled:Boolean(s.versionId)});action('選択版を再生','playSelectedVersion');}else{nav('保存版を選択','revisionlist');action('選択版を復元','restore',{enabled:s.versionId!==null});action('選択版を再生','playRevision',{enabled:s.versionId!==null});}break;
  case 'versionlist':selectList(versionsOf(s),s.versionId);break;
  case 'revisionlist':selectList(s.history,s.versionId);break;
  case 'chain':action('chainを編集','editVersion',{enabled:Boolean(song)});action('採用版にする','acceptVersion',{enabled:Boolean(versionOf(s))});nav('FXパラメーター','fxparameters',Boolean(versionOf(s)?.effects?.length));play();nav('履歴','history');break;
  case 'fxparameters':selectList(s.fxParameters??[],s.fxParameterId);break;
  case 'fxedit':{const selected=s.fxParameters?.find(p=>p.id===s.fxParameterId),secondary=(s.fxParameterValues?.[selected?.id]??selected?.value??0).toFixed(3);pad('値を下げる',{type:'adjustFxParameter',delta:-.01},{secondary});pad('値を上げる',{type:'adjustFxParameter',delta:.01},{secondary});action('新しい版へ保存','commitFxParameter',{enabled:Boolean(selected)});nav('パラメーター選択','fxparameters');break;}
  case 'parameters':{
   const enabled=master?Boolean(song):Boolean(route)&&route.id!=='__master';
   pad('ゲイン −0.5dB',{type:'adjustParameter',parameter:'gain_db',delta:-.5},{enabled});pad('ゲイン +0.5dB',{type:'adjustParameter',parameter:'gain_db',delta:.5},{enabled});action('調整を保存','commitParameters',{enabled});
   pad('0dBへ戻す',{type:'resetParameter',parameter:'gain_db'},{enabled});
   if(!master){pad('パンを左へ',{type:'adjustParameter',parameter:'pan',delta:-.02},{enabled});pad('パンを右へ',{type:'adjustParameter',parameter:'pan',delta:.02},{enabled});pad('パンを中央へ',{type:'resetParameter',parameter:'pan'},{enabled});}
   action('調整を破棄','discardParameters',{enabled});
   play();break;
  }
  case 'export':{const exportable=master?(s.exportScope==='album'?songsOf(s).length>0:Boolean(song)):tracksOf(s).length>0;
   for(const f of ['wav','mp3','flac'])action(f.toUpperCase(),`format:${f}`,{pressed:s.formats.includes(f),enabled:s.api.includes('export_start')});action('書き出し開始','export',{enabled:exportable&&s.formats.length>0});action('内容を確認','reviewExport',{enabled:exportable});action('プロジェクトをエクスポート','save',{enabled:has});action('MIDI','midi',{enabled:!master&&tracksOf(s).some(t=>t.instrument?.kind!=='audio'&&(t.notes?.length||t.note_count))});action('曲 / アルバム','toggleScope',{enabled:master});action('採用版にする','acceptVersion',{enabled:master&&Boolean(versionOf(s))});action('成果物を開く','reveal',{enabled:Boolean(s.lastOutput)});break;}
  case 'settings':action('音声出力','output');action('データフォルダ','dataDir');action('一覧更新','refresh');action('保存','save',{enabled:has});nav('制作の履歴','history',has&&!master);break;
  case 'jobs':action('状態更新','pollJobs');action('キャンセル','cancelJob',{enabled:Boolean(s.jobId)});action('成果物を開く','reveal',{enabled:Boolean(s.lastOutput)});selectList(s.jobs.map(j=>({...j,name:`Job ${String(j.id??j.job_id).slice(0,8)}`})),s.jobId);break;
 }
 return out;
}
export function buildPads(s) {
 const inventory=contextActions(s),out=s.mode==='revisionlist'?inventory.slice(0,3):inventory.slice(s.page*3,s.page*3+3);
 const make=(label,command,options={})=>({label,secondary:'',icon:'',pressed:false,enabled:true,disabled_reason:'現在は操作できません',busy:false,command,...options});
 while(out.length<3)out.push(make('—',null,{enabled:false}));
 out.push(make('前ページ',{type:'page',delta:-1},{enabled:s.page>0,icon:'‹'}),make('次ページ',{type:'page',delta:1},{enabled:s.page<pageCount(s)-1,icon:'›'}),make('戻る',{type:'back'},{icon:'↩'}),make('再生画面へ',{type:'navigate',mode:'listen'},{icon:'↩'}),make('停止',{type:'stop'},{enabled:isActive(s),icon:'■'}));
 const normal=contextActions({...s,mode:isMastering(s)?'mastering':'transport'}),params=contextActions({...s,mode:'parameters'});
 for(const type of ['play','back5','forward5'])out.push(normal.find(p=>p.command?.type===type)??make('—',null,{enabled:false}));
 out.push(params[0],params[1],params[2],make(isMastering(s)?'履歴':'経路・FX',{type:'navigate',mode:isMastering(s)?'history':'routing'},{enabled:Boolean(s.document)}));
 if(s.mode==='listen'){
  const has=Boolean(s.document),master=isMastering(s),song=songOf(s);
  out[3]=make('5秒進む',{type:'forward5'},{enabled:has,icon:'+5s'});
  out[4]=master?make('前の曲',{type:'listenSong',delta:-1},{enabled:songsOf(s).findIndex(x=>x.id===s.songId)>0,icon:'Ⅰ◀'}):make('トラック',{type:'navigate',mode:'tracks'},{enabled:has});
  out[5]=master?make('次の曲',{type:'listenSong',delta:1},{enabled:songsOf(s).findIndex(x=>x.id===s.songId)<songsOf(s).length-1,icon:'▶Ⅰ'}):make('書き出し',{type:'navigate',mode:'export'},{enabled:has});
  const relative=(label,target,delta)=>make(label,{type:'selectRelative',target,delta},{enabled:has,icon:delta<0?'‹':'›'});
  if(master){
   out.splice(8,7,
    make('Aを聴く',{type:'switchA'},{enabled:Boolean(song?.comparison?.a),secondary:comparisonLabel(song?.comparison?.a)}),
    make('Bを聴く',{type:'switchB'},{enabled:Boolean(song?.comparison?.b),secondary:comparisonLabel(song?.comparison?.b)}),
    make('版の比較',{type:'navigate',mode:'history'},{enabled:Boolean(song)}),
    relative('前の版','version',-1),relative('次の版','version',1),
    make('選択版をAへ',{type:'assignA'},{enabled:Boolean(song)}),make('選択版をBへ',{type:'assignB'},{enabled:Boolean(song)}));
  }else{
   const trackActions=contextActions({...s,mode:'tracks'});
   out.splice(8,7,...['mute','solo','audition'].map(type=>trackActions.find(p=>p.command.type===type)),
    relative('前のトラック','track',-1),relative('次のトラック','track',1),
    make('経路・FX',{type:'navigate',mode:'routing'},{enabled:has}),make('履歴',{type:'navigate',mode:'history'},{enabled:has}));
  }
 }
 // The main surface is an assignment panel; internal task screens remain available.
 if(s.mode==='listen'){
  if(!isMastering(s)){
   const play=out[0],has=Boolean(s.document);
   out.splice(0,15,...Array.from({length:15},()=>make('',null,{enabled:false})));
   const combined=stopOrHomeAction(s);
   out[0]=make(combined.label,combined.command,{enabled:combined.enabled,icon:combined.icon});
   out[7]=play;
   out[2]=make('書き出し',{type:'navigate',mode:'export'},{enabled:has});
  }else out[6]=make('',null,{enabled:false});
 }
 const pads=out.map((p,i)=>({...p,id:`pad-${i+1}`,surfaceMode:s.mode,core:i<8,enabled:p.enabled&&(!s.busy||['navigate','page','back','stop'].includes(p.command?.type)),busy:s.busy&&!['navigate','page','back','stop'].includes(p.command?.type)}));
 return applyCustomLayout(s,pads,{physicalOrder:getDesktopKeyOrder(pads)});
}
export function comparisonLabel(target) { return target?.kind==='source'?'原音':target?.version_id??'未割当'; }
export function commandForPad(s,index) { const pad=buildPads(s)[index]; return pad?.enabled ? pad.command : null; }

export function auditionChanges(baseline, trackId = null) {
  return [
    ...(baseline.tracks??[]).map(t=>({track_id:t.id,mute:trackId?t.id!==trackId:t.mute,solo:trackId?t.id===trackId:t.solo})),
    ...(baseline.returns??[]).map(b=>({bus_id:b.id,mute:b.mute,solo:trackId?false:b.solo}))
  ];
}
