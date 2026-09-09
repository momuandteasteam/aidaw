import type { Project } from './schema.js';

function variable(value: number): number[] {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128);
  return bytes;
}
function chunk(name: string, bytes: number[]) {
  const header = Buffer.alloc(8); header.write(name); header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, Buffer.from(bytes)]);
}
export function exportMidi(p: Project): Buffer {
  const header = Buffer.alloc(14); header.write('MThd'); header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8); header.writeUInt16BE(p.tracks.length + 1, 10); header.writeUInt16BE(p.ppq, 12);
  const tempo = Math.round(60_000_000 / p.bpm);
  const conductor = chunk('MTrk', [0, 255, 81, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255,
    0, 255, 88, 4, p.meter[0], Math.log2(p.meter[1]), 24, 8, ...variable(p.length_ticks), 255, 47, 0]);
  const tracks = p.tracks.map(t => {
    const name = [...Buffer.from(t.name)]; const bytes = [0, 255, 3, ...variable(name.length), ...name];
    const events = t.notes.flatMap(n => [
      { tick: n.tick, off: false, bytes: [0x90 | (n.channel - 1), n.pitch, n.velocity] },
      { tick: n.tick + n.duration, off: true, bytes: [0x80 | (n.channel - 1), n.pitch, 0] },
    ]).sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off));
    let tick = 0;
    for (const e of events) { bytes.push(...variable(e.tick - tick), ...e.bytes); tick = e.tick; }
    bytes.push(...variable(p.length_ticks - tick), 255, 47, 0); return chunk('MTrk', bytes);
  });
  return Buffer.concat([header, conductor, ...tracks]);
}
