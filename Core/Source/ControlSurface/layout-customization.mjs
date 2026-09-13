/** User key assignments contain catalogue IDs only, never executable code or arbitrary commands. */
export const customizableModes=Object.freeze(['listen','tracks','mastering']);
const editable=new Set(customizableModes);
const terminal=new Set(['stopped','completed','failed','cancelled']);
const safeBusy=new Set(['navigate','page','back','stop']);
const commandKey=command=>command?JSON.stringify(Object.entries(command).sort(([a],[b])=>a.localeCompare(b))):'';
export const layoutKey=state=>`${state.document?.kind==='mastering'?'mastering':'composition'}:${state.mode}`;

/** One assignment keeps its ID while the displayed action follows playback state. */
export function stopOrHomeAction(state){
 const active=Boolean(state.playback&&!terminal.has(state.playback.state));
 return {id:'stopOrHome',label:active?'停止':'先頭へ',command:{type:active?'stop':'home'},enabled:active||Boolean(state.document),icon:active?'■':'⇤'};
}

/** Optional candidates supply authoritative runtime labels/enabled states from the common action model. */
export function actionCatalogue(state,candidates=[]) {
 const has=Boolean(state.document),master=state.document?.kind==='mastering';
 const graph=state.document?.composition?.graph??state.document?.composition??state.document?.graph??state.document??{};
 const tracks=graph.tracks??[],album=state.document?.mastering;
 const sourceSongs=album?.songs??state.document?.songs??[];
 const songs=album?.song_order?album.song_order.map(id=>sourceSongs.find(x=>x.id===id)).filter(Boolean):sourceSongs;
 const song=songs.find(x=>x.id===state.songId),track=tracks.find(x=>x.id===state.trackId);
 const versions=[...(song?.versions??[])].reverse();
 const entries=[];
 const add=(id,label,command,enabled=true,extra={})=>entries.push({id,label,command,enabled,secondary:'',icon:'',pressed:false,busy:false,...extra});
 add('none','未割り当て',null,false);
 const combined=stopOrHomeAction(state);add(combined.id,combined.label,combined.command,combined.enabled,{icon:combined.icon,assignmentLabel:'停止 / 先頭へ（自動切替）'});
 for(const [id,label] of [['play',state.playback?.state==='playing'?'一時停止':'再生'],['home','先頭へ'],['back5','5秒戻る'],['forward5','5秒進む']])add(id,label,{type:id},master?Boolean(song):tracks.length>0);
 add('stop','停止',{type:'stop'},Boolean(state.playback&&!terminal.has(state.playback.state)));
 for(const [mode,label] of [['listen','再生'],['tracks','トラック'],['mastering','A/B比較'],['history','履歴'],['export','書き出し'],['routing','経路・FX']])add(`navigate:${mode}`,label,{type:'navigate',mode},mode==='modes'||has&&(mode!=='tracks'||!master)&&(mode!=='mastering'||master));
 add('page:previous','前ページ',{type:'page',delta:-1},state.page>0);
 add('page:next','次ページ',{type:'page',delta:1},false); // A candidate must provide the actual page bound.
 add('back','戻る',{type:'back'});
 for(const slot of ['A','B']){
  add(`assign${slot}`,`選択版を${slot}へ`,{type:`assign${slot}`},master&&Boolean(song&&state.versionId));
  add(`switch${slot}`,`${slot}を聴く`,{type:`switch${slot}`},master&&Boolean(song?.comparison?.[slot.toLowerCase()]));
 }
 for(const [suffix,delta,label] of [['previous',-1,'前'],['next',1,'次']]){
  const songIndex=songs.findIndex(x=>x.id===state.songId);
  add(`listenSong:${suffix}`,`${label}の曲`,{type:'listenSong',delta},master&&songIndex>=0&&songIndex+delta>=0&&songIndex+delta<songs.length);
  for(const [target,items,selected,title] of [['track',tracks,state.trackId,'トラック'],['version',versions,state.versionId,'版']]){
   const index=items.findIndex(x=>x.id===selected);
   add(`selectRelative:${target}:${suffix}`,`${label}の${title}`,{type:'selectRelative',target,delta},has&&(target==='version'?master:!master)&&index>=0&&index+delta>=0&&index+delta<items.length);
  }
 }
 for(const [id,label] of [['mute','ミュート'],['solo','ソロ'],['audition','トラックを試聴']])add(id,label,{type:id},!master&&Boolean(track));
 add('monitorMute','再生音量をミュート',{type:'monitorMute'},has);
 add('commitParameters','ゲイン・パンの調整を保存',{type:'commitParameters'},has);
 add('resetGain','ゲインを0dBへ',{type:'resetParameter',parameter:'gain_db'},has);
 add('resetPan','パンを中央へ',{type:'resetParameter',parameter:'pan'},has&&!master);
 add('openFile','プロジェクトをインポート',{type:'openFile'});
 add('save','プロジェクトをエクスポート',{type:'save'},has);
 return entries.map(entry=>{
  const candidate=entry.command&&candidates.find(p=>commandKey(p.command)===commandKey(entry.command));
  const resolved={...entry,...candidate,id:entry.id,command:entry.command};
  return {...resolved,enabled:resolved.enabled!==false&&(!state.busy||safeBusy.has(entry.command?.type)),busy:Boolean(state.busy&&!safeBusy.has(entry.command?.type))};
 });
}

const catalogueCommands=new Map(actionCatalogue({}).map(p=>[p.id,p.command]));
/** Every slot may be cleared or reassigned; only registered command IDs are accepted. */
export function validateLayout(mode,overrides,options={}) {
 if(!editable.has(mode))return 'この画面のボタン配置は固定です';
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))return 'ボタン配置が不正です';
 for(const [index,id] of Object.entries(overrides)){
  if(!/^(?:[0-9]|1[0-4])$/.test(index)||typeof id!=='string'||!catalogueCommands.has(id))return '登録されていないボタン操作です';
 }
 return null;
}

/** Invalid/stale preferences fail closed to the complete default layout. No input is mutated. */
export function applyCustomLayout(state,pads,options={}) {
 const overrides=state.customLayouts?.[layoutKey(state)];
 if(!overrides||!Object.keys(overrides).length)return pads;
 if(validateLayout(state.mode,overrides,{...options,pads}))return pads;
 const catalogue=new Map(actionCatalogue(state,options.candidates??pads).map(p=>[p.id,p]));
 return pads.map((pad,index)=>{
  if(!Object.hasOwn(overrides,index))return pad;
  const action=catalogue.get(overrides[index]);
  return {...pad,...action,label:action.id==='none'?'':action.label,id:pad.id,core:index<8,customActionId:action.id};
 });
}
