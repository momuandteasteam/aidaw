import {createSurfaceSnapshot} from './surface-contract.mjs';
import {renderWaveformSvg} from './waveform.mjs';
import {renderKeySvg,getCoreKeyOrder,getDesktopKeyOrder,keyNumberIndex} from './key-image.mjs';
import {buildPads,versionOf,graphOf,isMastering} from './model.mjs';
import {buildEncoders,commandForEncoder,renderEncoderFrame} from './encoders.mjs';

export const hardwareProfiles = Object.freeze({
  'stream-deck': Object.freeze({columns:5,rows:3,keyPixels:72,sdkImagePixels:144,encoders:0,touch:null}),
  'stream-deck-plus': Object.freeze({columns:4,rows:2,keyPixels:120,sdkImagePixels:144,encoders:4,touch:Object.freeze({width:800,height:100,segmentWidth:200})})
});

/** The first eight keys are the complete core. Remaining keys only accelerate it. */
export function buildHardwareFrame(pads, device='stream-deck') {
  const profile=Object.hasOwn(hardwareProfiles,device)?hardwareProfiles[device]:null;
  if(!profile)throw new Error('Unknown Stream Deck profile');
  if(pads.length!==15)throw new Error('Expected the complete 15-pad application frame');
  const order=device==='stream-deck-plus'?getCoreKeyOrder(pads):getDesktopKeyOrder(pads);
  const keys=order.map((sourceIndex,index)=>{const pad=pads[sourceIndex];return ({
    column:index%profile.columns,row:Math.floor(index/profile.columns),sourceIndex,
    essential:sourceIndex<8,label:pad.label,enabled:pad.enabled!==false,action:pad.command,
    svg:renderKeySvg(pad,keyNumberIndex(sourceIndex)),sdkImagePixels:profile.sdkImagePixels,hidImagePixels:profile.keyPixels
  });});
  return {device,profile,coreKeys:8,keys,connection:'adapter_required'};
}

/** Convert device coordinates to the same action the desktop invokes. */
export function hardwareKeyAction(frame,column,row) {
  if(!Number.isInteger(column)||!Number.isInteger(row)||column<0||row<0||column>=frame.profile.columns||row>=frame.profile.rows)return null;
  const key=frame.keys[row*frame.profile.columns+column];
  return key?.enabled?key.action:null;
}

export function buildHardwareSurface(state,device='stream-deck') {
  const frame=buildHardwareFrame(buildPads(state),device);
  const duration=Number(state.playback?.duration_frames??state.waveform?.duration_frames??(isMastering(state)?versionOf(state)?.duration_frames:graphOf(state).duration_frames)??0);
  const comparisons=createSurfaceSnapshot(state).comparisons,comparison=comparisons?.find(c=>c.selected);
  return {...frame,encoders:frame.profile.encoders?buildEncoders(state):[],touch:frame.profile.touch?{width:800,height:100,svg:renderWaveformSvg({peaks:state.waveform?.peaks??[],available:Boolean(state.waveform?.available),positionRatio:duration?Number(state.position)/duration:0,overlay:state.encoderOverlay,comparison,comparisons,role:state.waveform?.role})}:null};
}

export function hardwareEncoderAction(state,device,index,gesture,value) {
  const profile=Object.hasOwn(hardwareProfiles,device)?hardwareProfiles[device]:null;
  if(!profile||!Number.isInteger(index)||index<0||index>=profile.encoders)return null;
  return commandForEncoder(state,index,gesture,value);
}

export function hardwareTouchAction(state,device,x){
 if(!hardwareProfiles[device]?.touch||!state.document||!Number.isFinite(x)||x<0||x>800)return null;
 return {type:'seekToRatio',ratio:x/800};
}
