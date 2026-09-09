import { readFile } from 'node:fs/promises';
// JUCE MemoryBlock base64 is not RFC4648 base64.
export function juceBase64(data: Uint8Array) {
  const alphabet = '.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+';
  let result = `${data.length}.`, bits = 0, value = 0;
  for (const byte of data) { value |= byte << bits; bits += 8; while (bits >= 6) { result += alphabet[value & 63]; value >>>= 6; bits -= 6; } }
  if (bits) result += alphabet[value & 63];
  return result;
}
export async function massiveXStateFromNks(path: string) {
  const b = await readFile(path);
  if (b.length < 20 || b.length > 32_000_000 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'NIKS' || b.readUInt32LE(4) !== b.length - 8) throw new Error('Expected a complete NKS preset');
  const chunks = new Map<string, Buffer>();
  for (let i = 12; i < b.length;) {
    if (i + 8 > b.length) throw new Error('Truncated NKS chunk');
    const size = b.readUInt32LE(i + 4), tag = b.toString('ascii', i, i + 4);
    if (i + 8 + size > b.length || chunks.has(tag)) throw new Error('Invalid NKS chunk');
    chunks.set(tag, b.subarray(i + 8, i + 8 + size)); i += 8 + size + (size % 2);
  }
  // Observed NI VST magic for Massive X, not an interchangeable Massive preset.
  const plid = chunks.get('PLID'), pchk = chunks.get('PCHK');
  const expectedPlid = Buffer.from('0100000081a95653542e6d61676963ce4e692448', 'hex');
  const vst3Plid = Buffer.from('0100000084a95653542e6d6167696300a8565354332e75696494ce5653544ece6924486dce61737369ce76652078aa706c7567696e4e616d65a94d6173736976652058ac706c7567696e56656e646f72b24e617469766520496e737472756d656e7473', 'hex');
  if (!(plid?.equals(expectedPlid) || plid?.equals(vst3Plid)) || !pchk || pchk.length < 20 || pchk.readUInt32LE(0) !== 1 || pchk.readUInt32LE(4) !== 2) throw new Error('Unsupported Massive X NKS container');
  const xml = Buffer.from(`<VST3PluginState><IComponent>${juceBase64(pchk.subarray(4))}</IComponent><IEditController></IEditController></VST3PluginState>`);
  const host = Buffer.alloc(xml.length + 10); host.writeUInt32LE(0x21324356, 0); host.writeUInt32LE(xml.length, 4); xml.copy(host, 8);
  return juceBase64(host);
}
