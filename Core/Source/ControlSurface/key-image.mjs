/** Stream Deck key artwork: one 72-unit square, exported at 144 × 144 pixels. */
export const KEY_LOGICAL_SIZE = 72;
export const KEY_IMAGE_SIZE = 144;
export const KEY_COLUMNS = 5;
export const KEY_ROWS = 3;
// Semantic pad indices remain stable; physical order is shared by desktop and hardware.
export const CORE_KEY_ORDER = Object.freeze([0,1,2,6,3,4,5,7]);
export const DESKTOP_KEY_ORDER = Object.freeze([0,1,2,6,8,3,4,5,7,9,11,12,13,14,10]);
export const LISTEN_CORE_KEY_ORDER=Object.freeze([0,7,2,3,1,4,5,6]);
export const LISTEN_KEY_ORDER=Object.freeze([0,7,2,3,8,1,4,5,6,9,11,12,13,14,10]);
export const getCoreKeyOrder=pads=>pads[0]?.surfaceMode==='listen'?LISTEN_CORE_KEY_ORDER:CORE_KEY_ORDER;
export const getDesktopKeyOrder=pads=>pads[0]?.surfaceMode==='listen'?LISTEN_KEY_ORDER:DESKTOP_KEY_ORDER;
export const keyNumberIndex = sourceIndex => sourceIndex < 8 ? CORE_KEY_ORDER.indexOf(sourceIndex) : sourceIndex;

const xml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const graphemes = value => Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(String(value ?? '')), part => part.segment);
const units = glyph => /^[\x20-\x7e]+$/.test(glyph) ? glyph.length * .62 : 1;

/** Conservative fixed-width wrapping; no browser font measurement or DOM needed. */
export function compactKeyText(value, maxUnits = 7, maxLines = 2) {
  const chars=graphemes(String(value??'').replace(/\s+/g,' ').trim()), lines=[];
  let cursor=0;
  for(let row=0;row<maxLines&&cursor<chars.length;row++){
    let line='',width=0;
    while(cursor<chars.length&&width+units(chars[cursor])<=maxUnits){line+=chars[cursor];width+=units(chars[cursor]);cursor++;}
    if(row===maxLines-1&&cursor<chars.length){const clipped=graphemes(line);while(clipped.length&&clipped.reduce((sum,c)=>sum+units(c),0)>maxUnits-1)clipped.pop();line=clipped.join('')+'…';}
    lines.push(line.trim());
  }
  return lines.length?lines:[''];
}

const icons = {play:'▶',stop:'■',back5:'−5s',forward5:'+5s',home:'⇤',mute:'M',solo:'S',audition:'♪',switchA:'A',switchB:'B',assignA:'→ A',assignB:'→ B',create:'+',openFile:'↗',save:'↓',export:'↓',exportSong:'↓',exportAlbum:'↓',refresh:'↻',reveal:'↗',output:'◉',dataDir:'▱',editVersion:'≡',editRouting:'≡',reviewExport:'✓',acceptVersion:'✓',cancelJob:'×'};
// Visual priority follows the action, not the physical slot or current skin.
// High-contrast LCD artwork is shared with hardware; keycap reflections belong to the GUI.
export function keyAppearance(pad) {
  const {type,mode}=pad.command??{};
  if(!type)return {background:'#151b23',ink:'#8995a5',accent:'#465363',priority:'disabled'};
  if(type==='play')return {background:'#22ed87',ink:'#041b12',accent:'#22ed87',priority:'primary'};
  if(type==='stop')return {background:'#ff4557',ink:'#22040a',accent:'#ff4557',priority:'primary'};
  if(['home','back5','forward5','listenSong'].includes(type))return {background:'#124c9d',ink:'#ffffff',accent:'#55baff',priority:'transport'};
  let accent='#d5e3f3';
  if(/export|save|commit/i.test(type)||mode==='export')accent='#ffcb45';
  else if(/switch|assign|select|audition/i.test(type)||['tracks','history','tracklist'].includes(mode))accent='#be9aff';
  else if(type==='mute'||type==='cancelJob')accent='#ff6a78';
  else if(type==='solo'||type==='acceptVersion')accent='#ffcb45';
  else if(type==='navigate'||/Parameter|Routing|Version/.test(type))accent='#51d9ed';
  return pad.pressed?{background:accent,ink:'#08111c',accent:'#08111c',priority:'selected'}:{background:'#101c2c',ink:'#f5f8ff',accent,priority:'utility'};
}
function keySymbol(pad,icon,ink) {
  const type=pad.command?.type;
  const shapes={
    play:pad.icon==='Ⅱ'?'<rect x="27" y="14" width="6" height="21" rx="2"/><rect x="39" y="14" width="6" height="21" rx="2"/>':'<path d="M29 14 Q27 13 27 16 V34 Q27 37 30 35 L47 26 Q49 24 46 22 Z"/>',
    stop:'<rect x="26" y="14" width="21" height="21" rx="4"/>',
    home:'<rect x="24" y="15" width="3" height="20" rx="1.5"/><path d="M44 16 L30 25 L44 34 Z"/>',
  };
  if(shapes[type])return `<g fill="${ink}">${shapes[type]}</g>`;
  if(type==='navigate') {
    const mode=pad.command.mode;
    const drawing=mode==='export'?'<path d="M36 13V28 M29 22L36 29L43 22 M25 30V36H47V30"/>':mode==='history'?'<path d="M25 18A12 12 0 1 1 24 30 M24 13V21H32 M36 17V25L42 28"/>':mode==='modes'?'<rect x="24" y="13" width="9" height="9" rx="2"/><rect x="39" y="13" width="9" height="9" rx="2"/><rect x="24" y="28" width="9" height="9" rx="2"/><rect x="39" y="28" width="9" height="9" rx="2"/>':'<path d="M25 15V34 M36 15V34 M47 15V34"/><path d="M22 21H28 M33 29H39 M44 22H50" stroke-width="5"/>';
    return `<g fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>`;
  }
  return `<text x="36" y="32" font-size="${icon.length>2?'17':'24'}" font-weight="700" fill="${ink}">${xml(icon)}</text>`;
}
/** Rin-inspired iridescent crystal edges; the central action field stays clear. */
function keyTexture(background, accent, priority) {
  const pearlOpacity=priority==='primary'?'.48':'.7';
  return `<defs>
    <linearGradient id="lcd-depth" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#e9faff" stop-opacity=".2"/><stop offset=".38" stop-color="${background}" stop-opacity="0"/><stop offset="1" stop-color="#030c24" stop-opacity=".24"/></linearGradient>
    <linearGradient id="lcd-pearl" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4fcff"/><stop offset=".24" stop-color="#a3e2ff"/><stop offset=".48" stop-color="#ede0ff"/><stop offset=".68" stop-color="#fff1d5"/><stop offset=".85" stop-color="#9adfff"/><stop offset="1" stop-color="#f4fcff"/></linearGradient>
    <linearGradient id="lcd-facet" x1="0" y1="0" x2="1" y2=".4"><stop stop-color="#daf6ff" stop-opacity=".5"/><stop offset=".5" stop-color="#c4bbff" stop-opacity=".12"/><stop offset="1" stop-color="#efffff" stop-opacity=".03"/></linearGradient>
    <radialGradient id="lcd-bloom" cx="1" cy="1" r=".85"><stop stop-color="${accent}" stop-opacity=".34"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="72" height="72" rx="5" fill="url(#lcd-depth)"/>
  <rect width="72" height="72" rx="5" fill="url(#lcd-bloom)"/>
  <path d="M2 8Q2 2 8 2H51L18 12L3 37Z M70 29L60 52L34 70H65Q70 70 70 65Z" fill="url(#lcd-facet)"/>
  <path d="M3 37L18 12L51 2 M34 70L60 52L70 29" fill="none" stroke="url(#lcd-pearl)" stroke-width=".7" opacity=".42"/>
  <path d="M3 58L10 65L29 70 M54 2L65 8L70 23" fill="none" stroke="url(#lcd-pearl)" stroke-width="2" opacity=".16"/>
  <rect x="2.5" y="2.5" width="67" height="67" rx="5" fill="none" stroke="url(#lcd-pearl)" stroke-width=".65" opacity="${pearlOpacity}"/>
  <path d="M9 5H34 M68 43V60Q68 67 61 67H48" fill="none" stroke="url(#lcd-pearl)" stroke-width="1.2" opacity=".72"/>
  <path d="M8 11L11 8L14 11L11 14Z" fill="#edfbff" opacity=".45"/>
  `;
}
export function renderKeySvg(pad, index = 0) {
  if(!pad.command&&!pad.label)return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 72 72"><rect width="72" height="72" rx="5" fill="#0b1017"/></svg>';
  const type=pad.command?.type;
  const {background,ink,accent,priority}=keyAppearance(pad);
  const shortLabels={save:'エクスポート',openFile:'インポート',reviewExport:'内容を確認',acceptVersion:'採用版にする'};
  const gainStep=type==='adjustParameter'&&pad.command.parameter==='gain_db';
  const keyLabel=gainStep?`ゲイン ${pad.command.delta<0?'−':'＋'}`:shortLabels[type]??(type==='navigate'&&pad.command.mode==='chain'?'ステレオFX':pad.label);
  const label=compactKeyText(keyLabel,6.4),secondary=compactKeyText(gainStep?'0.5 dB':pad.secondary,11,1)[0];
  const icon=pad.icon||icons[type]||(type==='select'?'♪':type?.startsWith('format:')?type.split(':')[1].toUpperCase():type==='navigate'?'▦':'·');
  const labelStart=label.length>1?48:55;
  const symbolY=label.length>1||secondary?26:30;
  const symbolColor=priority==='utility'?accent:ink;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 72 72"><title>${xml(pad.label)}</title><rect width="72" height="72" rx="5" fill="${background}"/>${keyTexture(background,accent,priority)}<g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" text-anchor="middle"><g transform="translate(36 ${symbolY}) scale(${priority==='primary'?'1.35':'1.12'}) translate(-36 -25)">${keySymbol(pad,icon,symbolColor)}</g>${label.map((line,i)=>`<text x="36" y="${labelStart+i*11}" font-size="9.5" font-weight="750" fill="${ink}">${xml(line)}</text>`).join('')}${secondary?`<text x="36" y="68" font-size="5.5" font-weight="600" fill="${ink}">${xml(secondary)}</text>`:''}</g>${pad.pressed?`<rect x="2" y="2" width="68" height="68" rx="4" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="8" cy="8" r="2.5" fill="${ink}"/>`:''}${pad.busy?`<rect x="3" y="3" width="66" height="66" rx="4" fill="none" stroke="${ink}" stroke-width="1.5" stroke-dasharray="3 3"/>`:''}</svg>`;

}

/** The desktop and a future physical adapter consume the same frame and action. */
export function renderKeyFrame(pads) {
  if(pads.length!==KEY_COLUMNS*KEY_ROWS)throw new Error('A control deck frame must contain exactly 15 keys');
  return getDesktopKeyOrder(pads).map((sourceIndex,index)=>{
    const pad=pads[sourceIndex];
    return {sourceIndex,column:index%KEY_COLUMNS,row:Math.floor(index/KEY_COLUMNS),action:pad.command,enabled:pad.enabled,label:pad.label,logicalSize:KEY_LOGICAL_SIZE,imageSize:KEY_IMAGE_SIZE,svg:renderKeySvg(pad,keyNumberIndex(sourceIndex))};
  });
}
