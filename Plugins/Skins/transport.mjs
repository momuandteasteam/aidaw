import {element,createDisplay,createWaveform} from './elements.mjs';
export const manifest=Object.freeze({id:'transport',name:'Minimal Transport',version:'0.0.1',contractVersion:1});
export function mount({root,dispatch,initialSnapshot}){
 const lifecycle=new AbortController(),{signal}=lifecycle,d=root.ownerDocument;root.classList.add('skin-transport');
 const display=createDisplay(root),controls=element(d,'div','transport-controls');root.append(controls);
 const definitions=[['▶','再生 / 一時停止',{type:'transport.playPause'},'play'],['■','停止',{type:'transport.stop'},'stop'],['|◀','先頭へ',{type:'transport.home'},'seek'],['−5s','5秒戻る',{type:'transport.seekRelative',seconds:-5},'seek'],['+5s','5秒進む',{type:'transport.seekRelative',seconds:5},'seek']];
 const buttons=definitions.map(([text,label,action,availability])=>{const button=element(d,'button','transport-button',text);button.type='button';button.setAttribute('aria-label',label);button.title=label;button.addEventListener('click',()=>void dispatch(action),{signal});controls.append(button);return {button,availability};});
 const strip=element(d,'div','touch-strip');root.append(strip);const waveform=createWaveform(strip,dispatch,signal);
 const label=element(d,'label','transport-volume','再生音量'),volume=element(d,'input');volume.type='range';volume.min='-96';volume.max='0';volume.step='0.5';volume.setAttribute('aria-label','再生音量');label.append(volume);root.append(label);volume.addEventListener('input',()=>void dispatch({type:'monitor.setVolume',db:Number(volume.value)}),{signal});
 let disposed=false;function update(s){if(disposed)return;display(s);waveform(s);for(const {button,availability}of buttons)button.disabled=!s.actions[availability];buttons[0].button.textContent=s.transport.state==='playing'?'Ⅱ':'▶';if(d.activeElement!==volume)volume.value=String(s.transport.volumeDb);volume.disabled=!s.actions.volume;volume.setAttribute('aria-valuetext',`${s.transport.volumeDb} dB`);}
 update(initialSnapshot);return {update,dispose(){disposed=true;lifecycle.abort();root.replaceChildren();root.classList.remove('skin-transport');}};
}
