import * as deck from './deck.mjs';
import * as transport from './transport.mjs';
export function createSkinRegistry(modules=[deck,transport]){
 const registry=new Map();for(const module of modules){const m=module.manifest;if(!m||!/^[-a-z0-9]+$/.test(m.id)||m.contractVersion!==1||typeof module.mount!=='function'||registry.has(m.id))throw Error('Invalid or duplicate skin contract');registry.set(m.id,module);}
 return {list:()=>[...registry.values()].map(m=>({...m.manifest})),get(id){const module=registry.get(id);if(!module)throw Error(`Unknown skin: ${id}`);return module;}};
}
export function createSkinHost({root,runtime,registry=createSkinRegistry()}){
 let active=null,id=null,disposed=false;const dispatch=action=>runtime.dispatchAction(action);const unsubscribe=runtime.subscribe(snapshot=>active?.update(snapshot));
 return {list:registry.list,get selected(){return id;},select(next){if(disposed)throw Error('Skin host is disposed');if(next===id)return;const module=registry.get(next);active?.dispose();active=null;id=null;root.replaceChildren();try{active=module.mount({root,dispatch,initialSnapshot:runtime.snapshot()});id=next;}catch(error){root.replaceChildren();if(next!=='deck'){active=registry.get('deck').mount({root,dispatch,initialSnapshot:runtime.snapshot()});id='deck';}throw error;}},dispose(){disposed=true;unsubscribe();active?.dispose();active=null;root.replaceChildren();}};
}
