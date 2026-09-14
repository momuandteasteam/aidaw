import {buildHardwareSurface,hardwareKeyAction,hardwareEncoderAction,hardwareTouchAction} from '../../Core/Source/ControlSurface/hardware-profile.mjs';
export const profiles=[
  {id:'stream-deck',name:'Stream Deck',transport:'bridge',status:'adapter_required',version:'0.0.1',verifiedHardware:false},
  {id:'stream-deck-plus',name:'Stream Deck +',transport:'bridge',status:'adapter_required',version:'0.0.1',verifiedHardware:false}
];
export function createAdapter(profile) {
  return {handleMidi(){return null;},getMappings(){return [];},setMappings(){},reset(){},learn(){return null;},
    frame(state){return buildHardwareSurface(state,profile.id);},
    handleControl(event,state) {
      if(event?.kind==='key')return hardwareKeyAction(buildHardwareSurface(state,profile.id),event.column,event.row);
      if(event?.kind==='touch')return hardwareTouchAction(state,profile.id,event.x);
      if(event?.kind==='encoder')return hardwareEncoderAction(state,profile.id,event.index,event.gesture,event.value);
      return null;
    }};
}
