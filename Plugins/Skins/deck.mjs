import {element,createDisplay,createWaveform} from './elements.mjs';
export const manifest=Object.freeze({id:'deck',name:'Control Deck',version:'0.0.1',contractVersion:1});
export function mount({root,dispatch,initialSnapshot}){
 const lifecycle=new AbortController(),{signal}=lifecycle,d=root.ownerDocument;root.classList.add('skin-deck');
 const stage=element(d,'section','deck-stage');stage.setAttribute('aria-label','カバーアートと曲の操作');root.append(stage);
 const display=createDisplay(stage),deck=element(d,'section','deck pad-grid');deck.setAttribute('aria-label','15パッド操作パネル');stage.append(deck);
 const panel=element(d,'section','encoder-panel'),strip=element(d,'div','touch-strip'),knobs=element(d,'div','encoder-knobs');panel.append(strip,knobs);stage.append(panel);const waveform=createWaveform(strip,dispatch,signal),cells=[];
 for(let index=0;index<4;index++){
  const cell=element(d,'div','encoder-cell'),knob=element(d,'button','encoder-knob'),mark=element(d,'span','knob-mark'),caption=element(d,'span','encoder-caption');knob.type='button';knob.setAttribute('role','slider');knob.append(mark);cell.append(knob,caption);knobs.append(cell);cell.style.gridColumn=String(index+1);cells.push({cell,knob,caption});
  const gesture=(gesture,value=0)=>dispatch({type:'control.encoder',index,gesture,value});
  let drag=null,suppressClick=false;
  knob.addEventListener('wheel',e=>{e.preventDefault();if(!knob.disabled&&e.deltaY)void gesture('rotate',e.deltaY<0?1:-1);},{passive:false,signal});
  knob.addEventListener('pointerdown',e=>{if(knob.disabled)return;suppressClick=false;drag={x:e.clientX,y:e.clientY,steps:0};knob.setPointerCapture(e.pointerId);},{signal});
  knob.addEventListener('pointermove',e=>{if(!drag||knob.disabled)return;const steps=Math.trunc((drag.y-e.clientY+e.clientX-drag.x)/4),delta=steps-drag.steps;if(delta){drag.steps=steps;suppressClick=true;void gesture('rotate',delta);}},{signal});
  knob.addEventListener('pointerup',()=>{drag=null;},{signal});knob.addEventListener('pointercancel',()=>{drag=null;suppressClick=true;},{signal});
  knob.addEventListener('click',()=>{if(knob.disabled)return;if(suppressClick){suppressClick=false;return;}void gesture('press');},{signal});
  knob.addEventListener('keydown',e=>{if(knob.disabled)return;if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.code)){e.preventDefault();void gesture('rotate',['ArrowUp','ArrowRight'].includes(e.code)?1:-1);}},{signal});
 }
 let disposed=false;const keyNodes=new Map();
 function update(s){if(disposed)return;display(s);waveform(s);
  for(const [index,key]of s.keys.entries()){
   let node=keyNodes.get(key.sourceIndex);
   if(!node){
    const button=element(d,'button','key'),img=element(d,'img','key-artwork'),glass=element(d,'span','key-glass');
    button.type='button';img.alt='';img.draggable=false;glass.setAttribute('aria-hidden','true');button.append(img,glass);
    button.onclick=()=>void dispatch({type:'control.key',index:key.sourceIndex});node={button,img,svg:null,generation:0};keyNodes.set(key.sourceIndex,node);
   }
   const {button,img}=node;
   if(deck.children[index]!==button)deck.insertBefore(button,deck.children[index]??null);
   const attributes={'data-index':key.sourceIndex,'data-column':key.column,'data-row':key.row,'data-core':key.sourceIndex<8,'data-label':key.label,'data-empty':!key.label,'aria-pressed':Boolean(key.pressed),'data-busy':Boolean(key.busy),'data-switching':Boolean(key.switching)};
   for(const [name,value]of Object.entries(attributes))if(button.getAttribute(name)!==String(value))button.setAttribute(name,String(value));
   const title=`${key.label||'未割り当て'}${key.secondary?' · '+key.secondary:''}`;if(button.title!==title){button.title=title;button.setAttribute('aria-label',title);}
   button.disabled=!key.enabled;button.style.gridColumn=String(key.column+1);button.style.gridRow=String(key.row+1);img.width=key.imageSize;img.height=key.imageSize;
   if(node.svg!==key.svg){
    node.svg=key.svg;const generation=++node.generation,src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(key.svg);
    if(!img.getAttribute('src'))img.src=src;
    else{const ready=new d.defaultView.Image();ready.src=src;void ready.decode().then(()=>{if(!disposed&&node.generation===generation)img.src=src;}).catch(()=>{});}
   }
  }
  s.encoders.forEach((encoder,index)=>{const {cell,knob,caption}=cells[index];knob.disabled=!encoder.enabled;cell.dataset.disabled=String(!encoder.enabled);knob.title=encoder.enabled?`${encoder.title} · ${encoder.value} · ${encoder.hint}`:'無効';knob.setAttribute('aria-label',encoder.title||'未使用');for(const [key,value]of Object.entries({'aria-valuemin':encoder.min,'aria-valuemax':encoder.max,'aria-valuenow':encoder.valueNumber,'aria-valuetext':encoder.value}))knob.setAttribute(key,String(value));knob.style.setProperty('--rotation',`${encoder.normalized*270-135}deg`);caption.textContent=encoder.title;caption.title=encoder.title;});
 }
 update(initialSnapshot);return {update,dispose(){disposed=true;lifecycle.abort();for(const button of deck.children)button.onclick=null;root.replaceChildren();root.classList.remove('skin-deck');}};
}
