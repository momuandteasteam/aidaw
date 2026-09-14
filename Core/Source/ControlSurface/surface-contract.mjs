import {comparisonSelected,buildPads,commandForPad,songOf,graphOf,isMastering,isActive} from './model.mjs';
import {buildEncoders,commandForEncoder} from './encoders.mjs';
import {renderKeyFrame} from './key-image.mjs';
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
export const surfaceContractVersion=1;
/** Public presentation data never includes the project document or plugin state. */
export function audibleStemLayers(state,waveform){
 const tracks=graphOf(state).tracks??[],live=state.playback?.project_id===state.projectId?state.playback.effective_mix?.tracks??[]:[];
 const mixed=tracks.map(t=>({...t,...live.find(m=>(m.track_id??m.id)===t.id)})),solo=mixed.find(t=>t.solo);
 return (waveform?.layers??[]).map(layer=>{const track=mixed.find(t=>t.id===layer.track_id);return {...layer,name:track?.name??layer.track_id,audible:Boolean(track&&(solo?track===solo:!track.mute)),gain:10**((track?.gain_db??0)/20)};});
}
export function createSurfaceSnapshot(state,{sequence=0,artworkUrl=null,waveform=null,overlay=null,bootstrapping=false,duration=0}={}){
 const ready=Boolean(state.document),pads=buildPads(state),sampleRate=state.playback?.sample_rate??48000;
 const bpm=state.document?.kind==='composition'?graphOf(state).bpm:null;
 const song=isMastering(state)?songOf(state):null;
 const comparisons=song?['a','b'].map(slot=>{const selection=song.comparison[slot],v=song.versions.find(v=>selection.kind==='version'?v.id===selection.version_id:v.source_asset_id===selection.source_asset_id&&(!selection.version_id||selection.version_id===v.id));const key=JSON.stringify([state.projectId,song.id,{...selection,version_id:v?.id}]);return {slot:slot.toUpperCase(),selected:comparisonSelected(state,slot),label:selection.kind==='source'?'原音':v?.label??'未割当',meter:state.comparisonMeters?.[key]??null};}):null;
 return freeze({comparisonLoading:state.comparisonLoading??null,comparisons,artworkUrl,tempoBpm:Number.isFinite(bpm)&&bpm>0?bpm:null,contractVersion:1,sequence,project:{id:state.projectId,name:state.document?.name??'',kind:state.document?.kind??'composition',revision:state.document?.revision??null},
 title:(isMastering(state)?songOf(state)?.name:state.document?.name)??'プロジェクト未選択',mode:state.mode,
 selection:{songId:state.songId,versionId:state.versionId,comparison:state.activeSlot,playbackRevision:state.auditionRevision??null},
 transport:{id:state.playback?.playback_id??null,state:bootstrapping?'loading':state.playback?.state??'ready',position:Number(state.position)||0,duration:Number(state.playback?.duration_frames??duration)||0,sampleRate,ready,busy:Boolean(state.busy),volumeDb:state.monitorGain??0},
 actions:{play:ready&&!state.busy,stop:isActive(state),seek:ready&&duration>0,volume:ready},
 keys:renderKeyFrame(pads).map(k=>{const p=pads[k.sourceIndex];return {sourceIndex:k.sourceIndex,column:k.column,row:k.row,imageSize:k.imageSize,svg:k.svg,label:p.label,secondary:p.secondary,enabled:p.enabled,pressed:p.pressed,busy:p.busy,switching:p.command?.type===`switch${state.comparisonLoading}`,disabledReason:p.disabled_reason};}),
 encoders:buildEncoders(state).map(({title,value,hint,enabled,min,max,valueNumber,normalized})=>({title,value,hint,enabled,min,max,valueNumber,normalized})),
 waveform:waveform?structuredClone({peaks:waveform.peaks??[],available:Boolean(waveform.available),role:waveform.role,layers:state.document?.kind==='separation'?audibleStemLayers(state,waveform):undefined}):{peaks:[],available:false},overlay:overlay?{...overlay}:null});
}
export function resolveSurfaceAction(state,action,duration){
 if(!action||typeof action!=='object'||typeof action.type!=='string')return null;
 const ready=Boolean(state.document),finite=Number.isFinite;
 switch(action.type){
 case 'settings.open':return {settings:true};
 case 'control.key':{if(!Number.isInteger(action.index)||action.index<0||action.index>=15)return null;const command=commandForPad(state,action.index);return command?{command}:{unavailable:true};}
 case 'control.encoder':{if(!Number.isInteger(action.index)||action.index<0||action.index>3||!['rotate','press','touch'].includes(action.gesture)||!finite(action.value??0))return null;const command=commandForEncoder(state,action.index,action.gesture,action.value??0);return command?{command}:{unavailable:true};}
 case 'transport.playPause':return ready&&!state.busy?{command:{type:'play'}}:{unavailable:true};
 case 'transport.stop':return isActive(state)?{command:{type:'stop'}}:{unavailable:true};
 case 'transport.home':return ready?{command:{type:'home'}}:{unavailable:true};
 case 'transport.seek':return !finite(action.ratio)||action.ratio<0||action.ratio>1?null:ready&&duration>0?{command:{type:'seekToRatio',ratio:action.ratio}}:{unavailable:true};
 case 'transport.seekRelative':return !finite(action.seconds)||Math.abs(action.seconds)>3600?null:ready?{command:{type:'seekBy',frames:action.seconds*(state.playback?.sample_rate??48000)}}:{unavailable:true};
 case 'monitor.setVolume':return !finite(action.db)||action.db< -96||action.db>0?null:ready?{command:{type:'monitorVolume',delta:action.db-(state.monitorGain??0)}}:{unavailable:true};
 case 'project.import':return {command:{type:'openFile'}};
 case 'project.openWorkspace':return {command:{type:'openWorkspace'}};
 case 'project.export':return ready?{command:{type:'save'}}:{unavailable:true};
 case 'audio.export':return ready?{command:isMastering(state)?{type:'downloadMaster'}:state.document.kind==='separation'?{type:'separation'}:{type:'navigate',mode:'export'}}:{unavailable:true};
 default:return null;
 }
}
