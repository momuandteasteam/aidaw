import { readFile } from 'node:fs/promises';
import type { Service } from './service.js';
import { track, type Operation } from './schema.js';
export function parseMidi(bytes:Buffer){
 let at=0;const need=(n:number)=>{if(at+n>bytes.length)throw new Error('Truncated MIDI');};
 const u8=()=>{need(1);return bytes[at++];};const u16=()=>{need(2);const v=bytes.readUInt16BE(at);at+=2;return v;};const u32=()=>{need(4);const v=bytes.readUInt32BE(at);at+=4;return v;};
 const tag=()=>{need(4);const v=bytes.toString('ascii',at,at+4);at+=4;return v;};
 const vlq=()=>{let v=0;for(let i=0;i<4;i++){const b=u8();v=v*128+(b&127);if(!(b&128))return v;}throw new Error('Invalid MIDI variable length');};
 if(bytes.length>16*1024*1024)throw new Error('MIDI exceeds 16 MiB limit');
 if(tag()!=='MThd'||u32()!==6)throw new Error('Expected SMF header');const format=u16(),count=u16(),division=u16();if(format>1||division===0||(division&0x8000)||count>65)throw new Error('Only SMF 0/1 with PPQ timing and at most 65 tracks is supported');
 const tracks:any[]=[],tempos:any[]=[],meters:any[]=[],unsupported=new Set<string>();let endTick=0;
 const tick=(value:number)=>Math.round(value*960/division);
 for(let index=0;index<count;index++){
  if(tag()!=='MTrk')throw new Error('Expected MIDI track');const length=u32(),end=at+length;if(end>bytes.length)throw new Error('Truncated MIDI track');let time=0,running=0,name=`MIDI ${index+1}`;const notes:any[]=[],active=new Map<string,any[]>();
  while(at<end){time+=vlq();if(tick(time)>10000000)throw new Error('MIDI timeline too long');let status=u8();if(status<128){if(!running)throw new Error('Invalid running status');at--;status=running;}else if(status<240)running=status;
   if(status===255){running=0;const kind=u8(),n=vlq();need(n);const data=bytes.subarray(at,at+n);at+=n;
    if(kind===3)name=data.toString('utf8').slice(0,200)||name;
    if(kind===81&&n===3)tempos.push({tick:tick(time),value:data.readUIntBE(0,3)});
    if(kind===88&&n===4)meters.push({tick:tick(time),value:[data[0],2**data[1]]});
    if(kind===47){if(at!==end)throw new Error('Data after end-of-track');break;}
   }else if(status===240||status===247){running=0;const n=vlq();need(n);at+=n;unsupported.add('SysEx');}
   else if(status<240){const kind=status>>4,channel=(status&15)+1,a=u8(),b=kind===12||kind===13?0:u8();if(a>127||b>127)throw new Error('Invalid MIDI data byte');const key=`${channel}:${a}`;
    if(kind===9&&b>0){const queue=active.get(key)??[];queue.push({tick:tick(time),pitch:a,velocity:b,channel});active.set(key,queue);}
    else if(kind===8||(kind===9&&b===0)){const n=active.get(key)?.shift();if(!n)throw new Error('Unmatched MIDI note-off');notes.push({...n,id:`n${notes.length}`,duration:Math.max(1,tick(time)-n.tick)});}
    else unsupported.add(`channel event 0x${kind.toString(16)}`);
   }else throw new Error('Unsupported MIDI system event');
   if(at>end)throw new Error('MIDI event crosses track boundary');
  }
  if([...active.values()].some(q=>q.length))throw new Error('Unterminated MIDI note');endTick=Math.max(endTick,tick(time),...notes.map(n=>n.tick+n.duration));tracks.push({index,name,notes:notes.sort((a,b)=>a.tick-b.tick)});
 }
 if(at!==bytes.length)throw new Error('Trailing MIDI data');
 if(new Set(tempos.map(t=>t.value)).size>1||tempos.some(t=>t.tick>0))throw new Error('Variable tempo MIDI is not supported');
 if(new Set(meters.map(m=>JSON.stringify(m.value))).size>1||meters.some(m=>m.tick>0))throw new Error('Variable meter MIDI is not supported');
 return {format,source_ppq:division,ppq:960,bpm:tempos.length?60000000/tempos[0].value:120,meter:meters[0]?.value??[4,4],length_ticks:Math.max(1,endTick),tracks,unsupported:[...unsupported]};
}
export async function inspectMidi(path:string){return parseMidi(await readFile(path));}
export async function importMidi(service:Service,a:any){const midi=await inspectMidi(a.path);if(midi.unsupported.length&&!a.notes_only)throw new Error(`MIDI contains unsupported events: ${midi.unsupported.join(', ')}. Explicit notes_only is required to omit them.`);
 const operations:Operation[]=[];if(a.adopt_tempo){operations.push({op:'set_bpm',bpm:midi.bpm});operations.push({op:'set_timing',length_ticks:midi.length_ticks,meter:midi.meter});}
 for(const mapping of a.tracks){const part=midi.tracks.find(t=>t.index===mapping.track_index);if(!part)throw new Error('Unknown MIDI track index');operations.push({op:'add_track',track:track.parse({id:mapping.track_id,name:mapping.name??part.name,instrument:mapping.instrument,notes:part.notes})});}
 const result=await service.apply({project_id:a.project_id,base_revision:a.base_revision,request_id:a.request_id,operations});return {...result,omitted_events:midi.unsupported};
}
