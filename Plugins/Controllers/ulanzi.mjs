export const profile={id:'ulanzi',name:'Ulanzi',transport:'bridge',status:'adapter_required',verifiedHardware:false};
/** Model-specific transport must be supplied before commands can be received. */
export function createAdapter(){return {handleMidi(){return null;},handleControl(){return null;},learn(){return null;},getMappings(){return [];},setMappings(){},reset(){}};}
