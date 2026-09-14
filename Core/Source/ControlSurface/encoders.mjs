import {graphOf,tracksOf,songsOf,songOf,versionOf,versionsOf,isMastering,pageItems} from './model.mjs';
import {actionCatalogue} from './layout-customization.mjs';
import {compactKeyText} from './key-image.mjs';

export const STRIP_SEGMENT_WIDTH=200, STRIP_HEIGHT=100, ENCODER_COUNT=4;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const xml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const seconds=frames=>{const n=Math.floor(Number(frames||0)/48000);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};

export function encoderTarget(state) {
 if(isMastering(state)) {const song=songOf(state),version=versionOf(state);return song&&version?{key:`${state.projectId}:song:${song.id}:${version.id}`,kind:'mastering',project_id:state.projectId,song_id:song.id,version_id:version.id,base_revision:state.document.revision,name:song.name,gain_db:version.input_gain_db,pan:0}:null;}
 const track=tracksOf(state).find(t=>t.id===state.trackId),bus=(graphOf(state).buses??[]).find(b=>b.id===state.trackId),item=track??bus;
 return item?{key:`${state.projectId}:${track?'track':'bus'}:${item.id}`,kind:track?'track':'bus',project_id:state.projectId,[track?'track_id':'bus_id']:item.id,base_revision:state.document.revision,name:item.name,gain_db:item.gain_db,pan:item.pan}:null;
}
export function encoderSelection(state) {
 if(state.mode==='library')return {target:'project',label:'プロジェクト',items:pageItems(state),selected:state.projectId,mode:'library'};
 if(['history','versionlist','revisionlist'].includes(state.mode))return isMastering(state)?{target:'version',label:'履歴の版',items:versionsOf(state),selected:state.versionId,mode:'versionlist'}:{target:'revision',label:'保存履歴',items:state.history,selected:state.versionId,mode:'revisionlist'};
 if(isMastering(state))return {target:'song',label:'アルバムの曲',items:songsOf(state),selected:state.songId,mode:'songlist'};
 return {target:'track',label:'トラック / RETURN',items:[...tracksOf(state),...(graphOf(state).buses??[])],selected:state.trackId,mode:'routelist'};
}
function buildContextEncoders(state) {
 const graph=graphOf(state),duration=Number(state.playback?.duration_frames??(isMastering(state)?versionOf(state)?.duration_frames:graph.duration_frames??Math.round((graph.length_ticks??0)/(graph.ppq??960)*60/(graph.bpm??120)*48000)))||0;
 const target=encoderTarget(state),draft=state.dialDrafts?.[target?.key]?.conflict?null:state.dialDrafts?.[target?.key],gain=draft?.values.gain_db??target?.gain_db??0,pan=draft?.values.pan??target?.pan??0;
 const selection=encoderSelection(state),selected=selection.items.find(item=>String(item.id??item.project_id??item.revision)===String(selection.selected));
 const versions=versionsOf(state),version=versionOf(state),index=versions.findIndex(v=>v.id===version?.id);
 const available=!state.busy;
 const parameterStatus=parameter=>{const dirty=draft?.values[parameter]!==undefined;return {dirty,previewed:dirty&&draft.previewed,status:dirty?`${draft.saved?'調整を自動保存済み':'調整を保存中'}${draft.previewed?' · 試聴に反映':''}`:'保存済み'};};
 const items=[
  {index:0,title:'再生位置',value:seconds(state.position),detail:`/ ${seconds(duration)}`,hint:'回す:1秒 · 押す:再生 / 停止',touchHint:'タップ:位置指定 · 下部:先頭',enabled:available&&duration>0,min:0,max:duration,valueNumber:Number(state.position||0),normalized:duration?Number(state.position||0)/duration:0},
  {index:1,title:selection.label,value:selected?.name??selected?.label??(selected?.revision!==undefined?`R${selected.revision}`:'未選択'),detail:`${selection.items.length} 件`,hint:'回す:選択 · 押す:一覧',touchHint:'スワイプ:前後 · タップ:一覧',enabled:available&&(selection.items.length>0||selection.target==='revision'&&state.historyTotal>0),min:0,max:Math.max(0,selection.items.length-1),valueNumber:Math.max(0,selection.items.indexOf(selected)),normalized:selection.items.length>1?Math.max(0,selection.items.indexOf(selected))/(selection.items.length-1):0},
  {index:2,title:isMastering(state)?'曲の入力ゲイン':'チャンネルゲイン',value:`${gain>0?'+':''}${gain.toFixed(1)} dB`,detail:target?.name??'対象未選択',hint:'回す:0.5dB · 押す:調整を保存',touchHint:'タップ:0dB · 下部:保存',enabled:available&&Boolean(target),min:-96,max:12,valueNumber:gain,normalized:(gain+96)/108,...parameterStatus('gain_db')},
  isMastering(state)?{index:3,title:'比較する版',value:version?.label??'版未選択',detail:version?`${index+1} / ${versions.length}`:'',hint:'回す:版選択 · 押す:選択版を再生',touchHint:'スワイプ:版選択 · タップ:再生',enabled:available&&versions.length>0,min:0,max:Math.max(0,versions.length-1),valueNumber:Math.max(0,index),normalized:versions.length>1?Math.max(0,index)/(versions.length-1):0}:{index:3,title:'パン / BALANCE',value:pan===0?'CENTER':`${pan<0?'L':'R'} ${Math.round(Math.abs(pan)*100)}`,detail:target?.name??'対象未選択',hint:'回す:2% · 押す:調整を保存',touchHint:'タップ:中央 · 下部:保存',enabled:available&&Boolean(target),min:-1,max:1,valueNumber:pan,normalized:(pan+1)/2,...parameterStatus('pan')}
 ];
 if(state.mode==='listen'){
  const volume=state.monitorGain??0;
  items[1]={index:1,title:'再生音量',value:volume<=-96?'MUTE':`${volume.toFixed(1)} dB`,hint:'ドラッグ:音量 · 押す:ミュート',enabled:available,min:-96,max:0,valueNumber:volume,normalized:(volume+96)/96};
  items[2]=isMastering(state)?{...items[1],index:2,title:'曲',value:songOf(state)?.name??'未選択',hint:'ドラッグ:前後の曲を頭から再生',enabled:available&&songsOf(state).length>0,min:0,max:Math.max(0,songsOf(state).length-1),valueNumber:Math.max(0,songsOf(state).findIndex(s=>s.id===state.songId)),normalized:0}:{index:2,title:'ミキサー',value:'TRACKS',hint:'押す:トラックミキサー',enabled:available&&Boolean(state.document),min:0,max:1,valueNumber:0,normalized:0};
  if(!isMastering(state))items[3]={index:3,title:'',value:'—',hint:'',enabled:false,min:0,max:1,valueNumber:0,normalized:0};
 }
 return items.map(item=>({...item,normalized:clamp(item.normalized,0,1)}));
}
function contextCommandForEncoder(state,index,gesture,value=0) {
 const encoder=buildContextEncoders(state)[index];if(!encoder?.enabled)return null;
 const ticks=Math.trunc(Number(value)||0),delta=gesture==='swipe'?(Number(value)>0?1:-1):ticks;
 if(state.mode==='listen'&&index>0){
  const rotating=gesture==='rotate'||gesture==='swipe';
  if(index===1)return rotating?{type:'monitorVolume',delta:delta*.5}:gesture==='press'?{type:'monitorMute'}:null;
  if(index===2)return isMastering(state)?(rotating&&delta?{type:'listenSong',delta}:gesture==='press'?{type:'home'}:null):{type:'navigate',mode:'tracks'};
  return rotating&&delta?{type:'selectRelative',target:'version',delta}:gesture==='press'?{type:'playSelectedVersion'}:null;
 }
 if(gesture==='rotate'||gesture==='swipe'){
  if(!delta)return null;
  if(index===0)return {type:'seekBy',frames:delta*48000};
  if(index===1)return {type:'selectRelative',target:encoderSelection(state).target,delta};
  if(index===2)return {type:'adjustParameter',parameter:'gain_db',delta:delta*.5};
  return isMastering(state)?{type:'selectRelative',target:'version',delta}:{type:'adjustParameter',parameter:'pan',delta:delta*.02};
 }
 if(state.mode==='listen'&&(index===2||index===3&&!isMastering(state))&&(gesture==='press'||gesture==='tap'))return {type:'resetParameter',parameter:index===2?'gain_db':'pan'};
 if(gesture==='press')return index===0?{type:'play'}:index===1?{type:'openEncoderSelection',mode:encoderSelection(state).mode}:index===2||!isMastering(state)?{type:'commitParameters'}:{type:'playSelectedVersion'};
 if(gesture==='tap'){
  if(index===0)return value?.y>=74?{type:'home'}:{type:'seekToRatio',ratio:clamp(Number(value?.x??100)/200,0,1)};
  if(index===1)return {type:'openEncoderSelection',mode:encoderSelection(state).mode};
  if(index===3&&isMastering(state))return {type:'playSelectedVersion'};
  return value?.y>=74?{type:'commitParameters'}:{type:'resetParameter',parameter:index===2?'gain_db':'pan'};
 }
 if(gesture==='reset')return index===0?{type:'home'}:index===2||index===3&&!isMastering(state)?{type:'resetParameter',parameter:index===2?'gain_db':'pan'}:null;
 return null;
}
export const encoderRotations=Object.freeze([
 {id:'none',label:'未割り当て'}, {id:'seek',label:'再生位置',mode:'transport',index:0},
 {id:'volume',label:'再生音量',mode:'listen',index:1},
 {id:'track',label:'トラック選択',mode:'tracks',index:1,kind:'composition'},
 {id:'song',label:'曲選択',mode:'listen',index:2,kind:'mastering'},
 {id:'version',label:'版選択',mode:'mastering',index:3,kind:'mastering'},
 {id:'gain',label:'ゲイン',mode:'tracks',index:2},
 {id:'pan',label:'パン',mode:'tracks',index:3,kind:'composition'},
]);
const assignmentKind=state=>isMastering(state)?'mastering':'composition';
export function defaultEncoderAssignments(kind){
 return {3:{rotate:'volume',press:'monitorMute'}};
}
export function validateEncoderAssignments(assignments){
 if(!assignments||typeof assignments!=='object'||Array.isArray(assignments))return 'エンコーダの割り当てが不正です';
 const pressIds=new Set(actionCatalogue({}).map(a=>a.id));
 for(const [kind,slots]of Object.entries(assignments)){
  if(!['composition','mastering'].includes(kind)||!slots||typeof slots!=='object'||Array.isArray(slots))return 'エンコーダの対象が不正です';
  for(const [index,value]of Object.entries(slots)){
   if(!/^[0-3]$/.test(index)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['rotate','press'].includes(k)))return 'エンコーダの位置が不正です';
   if(!encoderRotations.some(r=>r.id===value.rotate)||!pressIds.has(value.press))return '登録されていないエンコーダ操作です';
  }
 }
 return null;
}
export function encoderAssignmentsFor(state){
 const kind=assignmentKind(state),saved=state.encoderAssignments??{};
 return {...defaultEncoderAssignments(kind),...(validateEncoderAssignments(saved)?{}:saved[kind])};
}
function assignedEncoder(state,index){
 const binding=encoderAssignmentsFor(state)[index]??{rotate:'none',press:'none'};
 const role=encoderRotations.find(r=>r.id===binding.rotate);
 const rotatedState={...state,mode:role?.mode??'listen'};
 const dial=role?.index!==undefined&&(!role.kind||role.kind===assignmentKind(state))?buildContextEncoders(rotatedState)[role.index]:null;
 const press=actionCatalogue(state).find(a=>a.id===binding.press);
 return {binding,role,rotatedState,dial,press};
}
export function buildEncoders(state){
 return Array.from({length:4},(_,index)=>{
  const {dial,press,role}=assignedEncoder(state,index);
  const fallback={title:press?.command?press.label:'',value:'—',enabled:false,min:0,max:1,valueNumber:0,normalized:0};
  const enabled=Boolean(dial?.enabled||press?.enabled);
  return {...(dial??fallback),index,enabled,hint:!enabled?'':`回す: ${role?.label??'未割り当て'} · 押す: ${press?.label??'未割り当て'}`};
 });
}
export function commandForEncoder(state,index,gesture,value=0){
 if(!Number.isInteger(index)||index<0||index>=4)return null;
 const {role,rotatedState,dial,press}=assignedEncoder(state,index);
 if(gesture==='press')return press?.enabled?press.command:null;
 if(!dial?.enabled||!['rotate','swipe'].includes(gesture))return null;
 return contextCommandForEncoder(rotatedState,role.index,gesture,value);
}
export function adjustEncoderDraft(state,parameter,delta,reset=false) {
 const target=encoderTarget(state);if(!target||!['gain_db','pan'].includes(parameter)||parameter==='pan'&&isMastering(state))return state;
 const drafts={...state.dialDrafts},previous=drafts[target.key],base=previous?.values[parameter]??target[parameter]??0;
 const value=Math.round(clamp(reset?0:base+delta,parameter==='gain_db'?-96:-1,parameter==='gain_db'?12:1)*100)/100;
 drafts[target.key]={target:previous?.target??target,values:{...previous?.values,[parameter]:value},previewed:false};
 return {...state,dialDrafts:drafts};
}
export function renderStripSegmentSvg(encoder) {
 const title=compactKeyText(encoder.title,12,1)[0],value=compactKeyText(encoder.value,8,1)[0],footer=encoder.monitorOnly?'リセット':encoder.index===0?'先頭へ':encoder.index===1?'一覧':encoder.index===3&&encoder.title==='比較する版'?'再生':'保存';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><title>${xml(encoder.title)} ${xml(encoder.value)} ${xml(encoder.touchHint)}</title><rect width="200" height="100" fill="#14141d"/><g opacity="${encoder.enabled?1:.4}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><text x="12" y="22" font-size="14" fill="#b8a1df">${xml(title)}</text><text x="12" y="52" font-size="21" font-weight="600" fill="#f0ebfa">${xml(value)}</text><rect x="12" y="63" width="176" height="4" rx="2" fill="#393342"/><rect x="12" y="63" width="${176*clamp(encoder.normalized,0,1)}" height="4" rx="2" fill="#baa0ed"/><text x="12" y="90" font-size="13" fill="#bcb3ca">${footer}</text>${encoder.dirty?`<text x="184" y="90" text-anchor="end" font-size="12" fill="#ffd59d">${encoder.previewed?'試聴中':'未保存'}</text>`:''}</g><path d="M199.5 0V100" stroke="#37313e"/></svg>`;
}
export function renderEncoderFrame(encoders) {
 if(encoders.length!==ENCODER_COUNT)throw new Error('A touch strip needs four encoder segments');
 return encoders.map((encoder,index)=>({index,x:index*200,y:0,width:200,height:100,enabled:encoder.enabled,svg:renderStripSegmentSvg(encoder),gestures:['rotate','press','tap','reset','swipe']}));
}
