import {comparisonPalette} from './comparison-palette.mjs';
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

const icons = {play:'▶',stop:'■',back5:'−5s',forward5:'+5s',home:'⇤',mute:'M',solo:'S',audition:'♪',switchA:'A',switchB:'B',cycleA:'A',cycleB:'B',assignA:'→ A',assignB:'→ B',create:'+',openFile:'↗',save:'↓',export:'↓',exportSong:'↓',exportAlbum:'↓',refresh:'↻',reveal:'↗',output:'◉',dataDir:'▱',editVersion:'≡',editRouting:'≡',reviewExport:'✓',acceptVersion:'✓',cancelJob:'×'};
// Visual priority follows the action, not the physical slot or current skin.
// High-contrast LCD artwork is shared with hardware; keycap reflections belong to the GUI.
export function keyAppearance(pad) {
  const {type}=pad.command??{};
  if(pad.enabled===false&&!pad.busy)return {background:'#202328',ink:'#858B93',accent:'#858B93',priority:'disabled'};
  if(!type)return {background:'#151A20',ink:'#8995A5',accent:'#8995A5',priority:'disabled'};
  if(/^(switch|cycle)[AB]$/.test(type)||type==='cycleSelected'){
    const color=comparisonPalette[type==='cycleSelected'?(pad.icon==='B'?'B':'A'):type.endsWith('A')?'A':'B'];
    return {background:pad.pressed?color.accent:color.surface,ink:pad.pressed?'#11161C':color.accent,accent:color.accent,priority:'primary'};
  }
  if(type==='play')return {background:'#1C2E28',ink:'#E6EAF0',accent:'#65DDB0',priority:'primary'};
  if(type==='stop')return {background:'#322329',ink:'#E6EAF0',accent:'#F28B98',priority:'primary'};
  if(['mute','solo'].includes(type)&&pad.icon?.startsWith('stem:'))return pad.pressed?{background:type==='mute'?'#873449':'#17634B',ink:'#FFFFFF',accent:type==='mute'?'#FFAAC0':'#93FFD1',priority:'selected'}:{background:'#20262E',ink:'#B1BAC3',accent:'#8F9CA8',priority:'utility'};
  const accent=['mute','cancelJob'].includes(type)?'#F28B98':['solo','acceptVersion'].includes(type)?'#65DDB0':'#C8D1DA';
  if(pad.pressed)return {background:'#35414D',ink:'#E6EAF0',accent,priority:'selected'};
  return {background:'#20262E',ink:'#E6EAF0',accent,priority:['home','back5','forward5','listenSong','moveSong'].includes(type)?'transport':'utility'};
}
// One optical box and stroke weight, independent of availability or priority.
function keySymbol(pad,icon,ink) {
  const type=pad.command?.type;
  const line=drawing=>`<g fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>`;
  if(['mute','solo'].includes(type)&&icon.startsWith('stem:')){
    const names={vocals:'ボーカル',drums:'ドラムス',bass:'ベース',other:'その他'};
    return `<text x="36" y="31" font-size="13" font-weight="650" fill="${ink}">${names[icon.slice(5)]??names.other}</text>`;
  }
  const tray='<path d="M36 14V29M29 23L36 30L43 23M24 30V37H48V30"/>';
  if(['switchA','switchB'].includes(type))return `<text x="36" y="36" font-size="30" font-weight="650" fill="${ink}">${type==='switchA'?'A':'B'}</text>`;
  if(['cycleA','cycleB','cycleSelected'].includes(type))return line('<path d="M29 14V11H45V16"/><rect x="23" y="17" width="22" height="23" rx="3"/><path d="M44 25H53M49 21L53 25L49 29"/>')+`<text x="34" y="34" font-size="16" font-weight="650" fill="${ink}">${type==='cycleSelected'?xml(icon):type==='cycleA'?'A':'B'}</text>`;
  if(type==='switchSeparation')return `<text x="36" y="29" font-size="10" font-weight="700" fill="${ink}">${xml(pad.secondary??'⇄')}</text>`;
  if(type==='moveSong'||type==='selectRelative'&&pad.command.target==='track')return line(`<path d="${pad.command.delta<0?'M36 37V15M28 23L36 15L44 23':'M36 15V37M28 29L36 37L44 29'}"/>`);
  if(type==='play')return pad.icon==='Ⅱ'?`<g fill="${ink}"><rect x="28" y="15" width="5" height="22" rx="1.5"/><rect x="39" y="15" width="5" height="22" rx="1.5"/></g>`:`<path fill="${ink}" d="M29 15Q28 14 28 16V36Q28 38 30 37L47 27Q49 26 47 25Z"/>`;
  if(type==='stop')return `<rect x="26" y="16" width="20" height="20" rx="3" fill="${ink}"/>`;
  if(type==='home')return line('<path d="M25 16V36M45 16L30 26L45 36Z"/>');
  if(['downloadMaster','separation','save','export','exportSong','exportAlbum'].includes(type))return line(tray);
  const drawings={
    openFile:'<path d="M24 23V18H33L37 22H48V37H24ZM36 16V30M31 25L36 30L41 25"/>',
    create:'<path d="M36 15V37M25 26H47"/>',
    cancelJob:'<path d="M27 17L45 35M45 17L27 35"/>',
    reviewExport:'<path d="M25 26L33 34L48 18"/>',
    acceptVersion:'<path d="M25 26L33 34L48 18"/>',
    output:'<path d="M24 22H29L37 16V36L29 30H24ZM42 21Q47 26 42 31M46 16Q55 26 46 36"/>',
    reveal:'<path d="M39 15H48V24M48 15L34 29M32 19H24V37H44V29"/>',
    dataDir:'<path d="M24 37V17H33L37 21H49V37Z"/>',
    editRouting:'<path d="M36 20V27H25V32M36 27H47V32"/><rect x="32" y="13" width="8" height="7" rx="1"/><rect x="21" y="32" width="8" height="7" rx="1"/><rect x="43" y="32" width="8" height="7" rx="1"/>',
    editVersion:'<path d="M25 18H48M25 26H43M25 34H48"/>',
  };
  if(drawings[type])return line(drawings[type]);
  if(type==='adjustParameter')return line(`<path d="M26 26H46${pad.command.delta>0?'M36 16V36':''}"/>`);
  if(type==='navigate') {
    const mode=pad.command.mode;
    const drawing=mode==='export'?tray:mode==='history'?'<path d="M25 18A12 12 0 1 1 24 30M24 13V21H32M36 17V25L42 28"/>':mode==='modes'?'<rect x="24" y="14" width="9" height="9" rx="2"/><rect x="39" y="14" width="9" height="9" rx="2"/><rect x="24" y="29" width="9" height="9" rx="2"/><rect x="39" y="29" width="9" height="9" rx="2"/>':'<path d="M25 15V37M36 15V37M47 15V37M22 22H28M33 30H39M44 23H50"/>';
    return line(drawing);
  }
  return `<text x="36" y="33" font-size="${icon.length>2?'17':'23'}" font-weight="600" fill="${ink}">${xml(icon)}</text>`;
}
export function renderKeySvg(pad, index = 0) {
  if(!pad.command&&!pad.label)return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 72 72"><rect x=".5" y=".5" width="71" height="71" rx="8" fill="#12171D" stroke="#252C34"/></svg>';
  const type=pad.command?.type;
  const {background,ink,accent,priority}=keyAppearance(pad);
  const shortLabels={save:'エクスポート',openFile:'インポート',reviewExport:'内容を確認',acceptVersion:'採用版にする'};
  const gainStep=type==='adjustParameter'&&pad.command.parameter==='gain_db';
  const comparisonKey=['switchA','switchB'].includes(type);
  const keyLabel=comparisonKey?'':['cycleA','cycleB','cycleSelected'].includes(type)?'音を切替':gainStep?`ゲイン ${pad.command.delta<0?'−':'＋'}`:shortLabels[type]??(type==='navigate'&&pad.command.mode==='chain'?'ステレオFX':pad.label);
  const label=comparisonKey?[]:compactKeyText(keyLabel,6.4);
  const icon=pad.icon||icons[type]||(type==='select'?'♪':type?.startsWith('format:')?type.split(':')[1].toUpperCase():type==='navigate'?'▦':'·');
  const labelStart=label.length>1?49:56;
  const symbolY=comparisonKey?36:label.length>1?25:28;
  const symbolColor=pad.pressed&&priority==='primary'&&type!=='play'&&type!=='stop'?ink:accent;
  const glow=pad.enabled&&pad.pressed&&pad.icon?.startsWith('stem:')?`<defs><filter id="stemGlow"><feGaussianBlur stdDeviation="1.6"/></filter></defs><rect x="4" y="4" width="64" height="64" rx="6" fill="none" stroke="${accent}" stroke-width="4" filter="url(#stemGlow)"/>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 72 72"><title>${xml(pad.label)}</title><rect x=".5" y=".5" width="71" height="71" rx="8" fill="${background}" stroke="${priority==='disabled'?'#30353C':'#3B444F'}"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" text-anchor="middle"><g transform="translate(0 ${symbolY-26})">${keySymbol(pad,icon,symbolColor)}</g>${label.map((line,i)=>`<text x="36" y="${labelStart+i*11}" font-size="9.5" font-weight="600" fill="${ink}">${xml(line)}</text>`).join('')}</g>${glow}${pad.pressed?`<rect x="2.5" y="2.5" width="67" height="67" rx="6" fill="none" stroke="${ink}" stroke-opacity=".7"/><circle cx="8" cy="8" r="2" fill="${ink}"/>`:''}</svg>`;
}

/** The desktop and a future physical adapter consume the same frame and action. */
export function renderKeyFrame(pads) {
  if(pads.length!==KEY_COLUMNS*KEY_ROWS)throw new Error('A control deck frame must contain exactly 15 keys');
  return getDesktopKeyOrder(pads).map((sourceIndex,index)=>{
    const pad=pads[sourceIndex];
    return {sourceIndex,column:index%KEY_COLUMNS,row:Math.floor(index/KEY_COLUMNS),action:pad.command,enabled:pad.enabled,label:pad.label,logicalSize:KEY_LOGICAL_SIZE,imageSize:KEY_IMAGE_SIZE,svg:renderKeySvg(pad,keyNumberIndex(sourceIndex))};
  });
}
