import {buildPads,commandForPad} from '../../Core/Source/ControlSurface/model.mjs';
import {getCoreKeyOrder} from '../../Core/Source/ControlSurface/key-image.mjs';
import {commandForEncoder} from '../../Core/Source/ControlSurface/encoders.mjs';

/** Complete Web MIDI channel messages only; never treat SysEx or note-off as a press. */
export function parseMidiMessage(data) {
  if (!data || data.length !== 3 || !Array.from(data).every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  const [status, number, value] = data;
  if (number > 127 || value > 127) return null;
  const family = status & 0xf0, channel = status & 0x0f;
  if (family === 0x80 || family === 0x90) return {type:'note',channel,number,value,pressed:family === 0x90 && value > 0};
  if (family === 0xb0) return {type:'cc',channel,number,value,pressed:value > 0};
  return null;
}
const modes = ['absolute','relative-twos-complement','relative-binary-offset','press'];
function validTarget(target) {
  return target && Number.isInteger(target.index) && target.index >= 0 && (target.kind === 'key' ? target.index < 8 : target.kind === 'encoder' && target.index < 4 && modes.includes(target.mode));
}
function validMapping(mapping) {
  const s=mapping?.source;
  return validTarget(mapping?.target) && s && ['note','cc'].includes(s.type) && Number.isInteger(s.channel) && s.channel >= 0 && s.channel < 16 && Number.isInteger(s.number) && s.number >= 0 && s.number < 128 && (mapping.target.kind === 'key' || mapping.target.mode === 'press' || s.type === 'cc');
}
const sourceKey = source => `${source.type}:${source.channel}:${source.number}`;
const targetKey = target => `${target.kind}:${target.index}:${target.kind === 'key' ? 'press' : target.mode === 'press' ? 'press' : 'rotate'}`;

export function createMidiAdapter({mappings:initialMappings=[]} = {}) {
  let mappings=[];
  const previous=new Map();
  const adapter={
    setMappings(items) {
      mappings=[]; previous.clear();
      for(const mapping of Array.isArray(items) ? items : []) {
        if(!validMapping(mapping))continue;
        const copy=structuredClone(mapping);
        mappings=mappings.filter(m => sourceKey(m.source)!==sourceKey(copy.source) && targetKey(m.target)!==targetKey(copy.target));
        mappings.push(copy);
      }
    },
    getMappings(){return structuredClone(mappings);},
    reset(){previous.clear();},
    learn(data,target) {
      const message=parseMidiMessage(data);
      if(!message || !validTarget(target) || message.type==='note' && !message.pressed)return null;
      if((target.kind==='key'||target.mode==='press')&&!message.pressed)return null;
      const mapping={source:{type:message.type,channel:message.channel,number:message.number},target:structuredClone(target)};
      if(!validMapping(mapping))return null;
      adapter.setMappings([...mappings,mapping]);
      // A learned press must be released before it can execute a command.
      previous.set(sourceKey(message),message.value);
      return structuredClone(mapping);
    },
    handleMidi(data,state) {
      const message=parseMidiMessage(data); if(!message)return null;
      const key=sourceKey(message),mapping=mappings.find(m=>sourceKey(m.source)===key);
      if(!mapping)return null;
      const before=previous.get(key); previous.set(key,message.pressed ? message.value : 0);
      const target=mapping.target;
      if(target.kind==='key'||target.mode==='press') {
        if(!message.pressed || before>0)return null;
        return target.kind==='key' ? commandForPad(state,getCoreKeyOrder(buildPads(state))[target.index]) : commandForEncoder(state,target.index,'press');
      }
      let delta=0;
      if(target.mode==='absolute') {if(before===undefined)return null;delta=message.value-before;}
      else if(target.mode==='relative-twos-complement')delta=message.value<64?message.value:message.value-128;
      else delta=message.value-64;
      return delta ? commandForEncoder(state,target.index,'rotate',delta) : null;
    }
  };
  adapter.setMappings(initialMappings);
  return adapter;
}
