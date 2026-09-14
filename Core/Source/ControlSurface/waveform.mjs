import {comparisonPalette} from './comparison-palette.mjs';
/** Device-independent 800 × 100 waveform artwork for the desktop touch strip. */
export const WAVEFORM_WIDTH = 800;
export const WAVEFORM_HEIGHT = 100;

const xml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const clampRatio = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const coordinate = value => Number(value.toFixed(3));
const concise = (value, limit) => {
  const characters = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : characters.join('');
};

const approximateWidth=(text,size)=>Array.from(text).reduce((width,ch)=>width+size*(/[\x20-\x7e]/.test(ch)?0.62:1),0);
export function fitWaveformName(text,width,size,weight,measure=approximateWidth){
 if(measure(text,size,weight)<=width)return text;
 const chars=Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text),s=>s.segment);let low=0,high=chars.length;
 while(low<high){const middle=Math.ceil((low+high)/2);if(measure(chars.slice(0,middle).join('')+'…',size,weight)<=width)low=middle;else high=middle-1;}
 return chars.slice(0,low).join('')+'…';
}

/** Draw only supplied measured peaks. Missing audio is represented by an empty baseline. */
export function renderWaveformSvg({ peaks = [], layers, positionRatio = 0, overlay, comparison, comparisons, role, measureText=approximateWidth, available = true } = {}) {
  const rows=comparisons??(comparison?[comparison]:[]),color=comparisonPalette[comparison?.slot??'A']??comparisonPalette.A;
  const measured = Array.isArray(peaks) && available ? peaks : [];
  const bins = Math.min(measured.length, WAVEFORM_WIDTH);
  const segments = [];
  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor(bin * measured.length / bins);
    const end = Math.floor((bin + 1) * measured.length / bins);
    let amplitude = 0;
    for (let index = start; index < end; index++) {
      const value = measured[index];
      if (Number.isFinite(value)) amplitude = Math.max(amplitude, Math.min(1, Math.abs(value)));
    }
    // Zero amplitude stays at zero height: silence never becomes an invented waveform.
    if (amplitude === 0) continue;
    const x = coordinate((bin + .5) * WAVEFORM_WIDTH / bins);
    const height = amplitude * 48;
    segments.push(`M${x},${coordinate(50 - height)}V${coordinate(50 + height)}`);
  }
  const playhead = coordinate(clampRatio(positionRatio) * WAVEFORM_WIDTH);
  let waveform = segments.length ? `<path data-waveform="measured" d="${segments.join('')}" fill="none" stroke="${color.accent}" stroke-width="1"/>` : '';
  if(Array.isArray(layers))waveform=layers.filter(l=>l.audible).map(layer=>{
   const data=Array.isArray(layer.peaks)?layer.peaks:[],count=Math.min(data.length,WAVEFORM_WIDTH),lines=[];
   for(let i=0;i<count;i++){let amplitude=0;for(let j=Math.floor(i*data.length/count);j<Math.floor((i+1)*data.length/count);j++)if(Number.isFinite(data[j]))amplitude=Math.max(amplitude,Math.min(1,Math.abs(data[j])*(layer.gain??1)));
    if(amplitude>0){const x=coordinate((i+.5)*WAVEFORM_WIDTH/count),height=amplitude*48;lines.push(`M${x},${coordinate(50-height)}V${coordinate(50+height)}`);}
   }
   return lines.length?`<path data-stem="${xml(layer.track_id)}" d="${lines.join('')}" fill="none" stroke="${color.accent}" stroke-width="1" opacity=".45"/>`:'';
  }).join('');
  const overlayTitle = concise(overlay?.title, 42);
  const overlayValue = concise(overlay?.value, 26);
  const overlayMarkup = overlay ? `<g data-overlay="parameter"><rect x="198" y="8" width="404" height="84" rx="8" fill="#111a22" fill-opacity=".96" stroke="#638292" stroke-opacity=".7"/><text x="400" y="34" fill="#a5bbc7" font-size="16">${xml(overlayTitle)}</text><text x="400" y="70" fill="#e3f2f6" font-size="28" font-weight="600">${xml(overlayValue)}</text></g>` : '';
  const db=value=>value>0?(20*Math.log10(value)).toFixed(1):'−∞';
  const compareMarkup=rows.length&&!overlay?`<g data-overlay="comparison">${['A','B'].map(slot=>{
   const row=rows.find(r=>r.slot===slot),y=slot==='A'?0:72,tint=comparisonPalette[slot].accent;
   const meter=row?.meter?`RMS ${db(row.meter.rms)} · Peak ${db(row.meter.peak)}`:'RMS / Peak 未測定';
   const weight=row?.selected?750:550,meterWidth=measureText(meter,18,550),nameWidth=Math.max(0,788-meterWidth-16-12);
   const name=fitWaveformName(`${slot} · ${row?.label??'未選択'}`,nameWidth,20,weight,measureText);
   return `<g data-comparison-slot="${slot}"><title>${xml(`${slot}: ${row?.label??'未選択'} · ${meter} dBFS · 直近400ms`)}</title><rect x="0" y="${y+3}" width="3" height="22" fill="${tint}"/><text data-comparison-name="${slot}" data-name-width="${coordinate(nameWidth)}" x="12" y="${y+21}" text-anchor="start" fill="#f5f8ff" stroke="#080e18" stroke-width="3" stroke-linejoin="round" paint-order="stroke" font-size="20" font-weight="${weight}">${xml(name)}</text><text x="788" y="${y+21}" text-anchor="end" fill="#f5f8ff" stroke="#080e18" stroke-width="3" stroke-linejoin="round" paint-order="stroke" font-size="18" font-weight="550">${xml(meter)}</text></g>`;

  }).join('')}</g>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100" viewBox="0 0 800 100"><title>${xml(overlay ? `${overlayTitle}: ${overlayValue}` : '再生波形')}</title><rect width="800" height="100" fill="#10171d"/><rect data-elapsed="${comparison?.slot??'A'}" width="${playhead}" height="100" fill="${color.elapsed}"/><path d="M0,50H800" stroke="#2c3b46" stroke-width="1"/>${waveform}<path data-playhead="${playhead}" d="M${playhead},0V100" stroke="#d7ecf0" stroke-width="2"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" text-anchor="middle">${compareMarkup}${overlayMarkup}</g></svg>`;
}
