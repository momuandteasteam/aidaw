import {createMidiAdapter} from './midi.mjs';
export const profile={id:'novation-launch-control',name:'Novation Launch Control',transport:'midi',status:'midi_learn_required',version:'0.0.1',verifiedHardware:false};
export const createAdapter=(_profile,options)=>createMidiAdapter(options);
