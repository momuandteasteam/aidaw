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

/** Draw only supplied measured peaks. Missing audio is represented by an empty baseline. */
export function renderWaveformSvg({ peaks = [], positionRatio = 0, overlay, available = true } = {}) {
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
    const height = amplitude * 39;
    segments.push(`M${x},${coordinate(50 - height)}V${coordinate(50 + height)}`);
  }
  const playhead = coordinate(clampRatio(positionRatio) * WAVEFORM_WIDTH);
  const waveform = segments.length ? `<path data-waveform="measured" d="${segments.join('')}" fill="none" stroke="url(#wave-color)" stroke-width="1"/><path d="${segments.join('')}" fill="none" stroke="#a6ffe0" stroke-width="1" clip-path="url(#elapsed)"/>` : '';
  const overlayTitle = concise(overlay?.title, 42);
  const overlayValue = concise(overlay?.value, 26);
  const overlayMarkup = overlay ? `<g data-overlay="parameter"><rect x="198" y="8" width="404" height="84" rx="8" fill="#111a22" fill-opacity=".96" stroke="#638292" stroke-opacity=".7"/><text x="400" y="34" fill="#a5bbc7" font-size="16">${xml(overlayTitle)}</text><text x="400" y="70" fill="#e3f2f6" font-size="28" font-weight="600">${xml(overlayValue)}</text></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100" viewBox="0 0 800 100"><title>${xml(overlay ? `${overlayTitle}: ${overlayValue}` : '再生波形')}</title><defs><linearGradient id="wave-color" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="800" y2="0"><stop stop-color="#4da6ff"/><stop offset=".48" stop-color="#32d9f0"/><stop offset="1" stop-color="#44f4ad"/></linearGradient><clipPath id="elapsed"><rect width="${playhead}" height="100"/></clipPath></defs><rect width="800" height="100" fill="#10171d"/><path d="M0,50H800" stroke="#2c3b46" stroke-width="1"/>${waveform}<path data-playhead="${playhead}" d="M${playhead},0V100" stroke="#d7ecf0" stroke-width="2"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" text-anchor="middle">${overlayMarkup}</g></svg>`;
}
