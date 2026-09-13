export function isBasicInstrument(s:any){return s?.kind==='builtin'||(s?.kind==='plugin'&&(/DLSMusicDevice|DLS Music Device|QuickTime|Microsoft.*GS Wavetable/i.test(s.plugin_id)));}
