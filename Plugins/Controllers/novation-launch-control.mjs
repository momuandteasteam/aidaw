import {createMidiAdapter} from './midi.mjs';
export const profile={id:'novation-launch-control',name:'Novation Launch Control',transport:'midi',status:'midi_learn_required',verifiedHardware:false};
export const createAdapter=(_profile,options)=>createMidiAdapter(options);
