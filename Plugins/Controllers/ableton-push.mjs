import {createMidiAdapter} from './midi.mjs';
export const profile={id:'ableton-push',name:'Ableton Push',transport:'midi',status:'midi_learn_required',verifiedHardware:false};
export const createAdapter=(_profile,options)=>createMidiAdapter(options);
