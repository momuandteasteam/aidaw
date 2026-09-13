import * as streamDeck from './stream-deck.mjs';
import * as ulanzi from './ulanzi.mjs';
import * as push from './ableton-push.mjs';
import * as launchControl from './novation-launch-control.mjs';
export {parseMidiMessage,createMidiAdapter} from './midi.mjs';
const registry=new Map();
/** Register a trusted, separately imported controller module. Duplicate IDs are rejected. */
export function registerController(profile,createAdapter) {
  if(!profile || !/^[a-z][a-z0-9-]*$/.test(profile.id) || typeof profile.name!=='string' || !['bridge','midi'].includes(profile.transport) || typeof createAdapter!=='function')throw new TypeError('Invalid controller registration');
  if(registry.has(profile.id))throw new Error(`Controller already registered: ${profile.id}`);
  registry.set(profile.id,{profile:Object.freeze({...profile}),createAdapter});
}
export function listControllerProfiles(){return [...registry.values()].map(entry=>({...entry.profile}));}
export function getControllerProfile(id){const entry=registry.get(id);return entry?{...entry.profile}:null;}
export function createControllerAdapter(id,options={}) {
  const entry=registry.get(id);if(!entry)throw new Error(`Unknown controller: ${id}`);
  return entry.createAdapter(entry.profile,options);
}
for(const profile of streamDeck.profiles)registerController(profile,streamDeck.createAdapter);
for(const module of [ulanzi,push,launchControl])registerController(module.profile,module.createAdapter);
