
import {buildPads} from '../../ControlSurface/model.mjs';
import {getDesktopKeyOrder} from '../../ControlSurface/key-image.mjs';
import {encoderRotations,encoderAssignmentsFor,validateEncoderAssignments} from '../../ControlSurface/encoders.mjs';
import {actionCatalogue,validateLayout,layoutKey} from '../../ControlSurface/layout-customization.mjs';
export function setupLayoutSettings({getState,setLayouts,setEncoders,initial={},initialEncoders={}}){
 const $=id=>document.getElementById(id);
 let layouts=structuredClone(initial),encoders=structuredClone(initialEncoders),selected=0;
 function view(){const [kind,mode]=$('layoutMode').value.split(':');return {...getState(),mode,page:0,document:getState().document?.kind===kind?getState().document:{kind},customLayouts:layouts,encoderAssignments:encoders};}
 function draw(){
  const state=view(),defaults=buildPads({...state,customLayouts:{}}),catalogue=new Map(actionCatalogue(state,defaults).map(a=>[a.id,a])),pads=defaults.map((pad,index)=>catalogue.get(layouts[layoutKey(state)]?.[index])??pad),order=getDesktopKeyOrder(defaults);
  $('layoutGrid').replaceChildren();
  for(const [slot,index]of order.entries()){const button=document.createElement('button');button.type='button';button.textContent=pads[index].label||'未割り当て';button.dataset.core=String(index<8);button.dataset.selected=String(index===selected);button.setAttribute('aria-label',`${Math.floor(slot/5)+1}行${slot%5+1}列 ${pads[index].label}`);button.addEventListener('click',()=>{selected=index;draw();});$('layoutGrid').append(button);}
  $('layoutAction').replaceChildren(new Option('既定の操作',''),...actionCatalogue(state,defaults).map(action=>new Option(action.assignmentLabel??action.label,action.id)));
  $('layoutAction').value=layouts[layoutKey(state)]?.[selected]??'';
  const bindings=encoderAssignmentsFor(state),kind=state.document.kind;
  $('encoderAssignments').replaceChildren();
  for(let index=0;index<4;index++){
   const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=`エンコーダ ${index+1}`;row.append(legend);
   for(const [gesture,title,options]of [['rotate','回す',encoderRotations.filter(r=>!r.kind||r.kind===kind)],['press','押す',actionCatalogue(state,defaults)]]){
    const label=document.createElement('label'),select=document.createElement('select');label.textContent=title;select.setAttribute('aria-label',`エンコーダ ${index+1} ${title}`);
    select.replaceChildren(...options.map(a=>new Option(a.assignmentLabel??a.label,a.id)));select.value=bindings[index]?.[gesture]??'none';
    select.addEventListener('change',()=>{const previous=encoderAssignmentsFor(view())[index]??{rotate:'none',press:'none'};encoders={...encoders,[kind]:{...encoders[kind],[index]:{...previous,[gesture]:select.value}}};$('layoutMessage').textContent='未保存です。保存すると反映されます。';});
    label.append(select);row.append(label);
   }
   $('encoderAssignments').append(row);
  }

 }
 $('layoutMode').addEventListener('change',draw);
 $('layoutApply').addEventListener('click',async()=>{
  const state=view(),key=layoutKey(state),overrides={...layouts[key]},id=$('layoutAction').value;
  if(id)overrides[selected]=id;else delete overrides[selected];
  layouts={...layouts,[key]:overrides};draw();$('layoutMessage').textContent='未保存です。配置を確認して保存してください。';
 });
 $('layoutSave').addEventListener('click',async()=>{
  const state=view(),defaults=buildPads({...state,customLayouts:{}}),problem=validateLayout(state.mode,layouts[layoutKey(state)]??{},{pads:defaults,physicalOrder:getDesktopKeyOrder(defaults)});
  if(problem||validateEncoderAssignments(encoders)){$('layoutMessage').textContent=problem||validateEncoderAssignments(encoders);return;}
  try{await window.aidaw.saveLayoutPreferences(layouts,encoders);setLayouts(structuredClone(layouts));setEncoders(structuredClone(encoders));$('layoutMessage').textContent='配置を保存しました。';}catch(e){$('layoutMessage').textContent=e.message;}
 });
 $('layoutReset').addEventListener('click',async()=>{
  const next={...layouts},nextEncoders={...encoders},state=view();delete next[layoutKey(state)];delete nextEncoders[state.document.kind];
  try{await window.aidaw.saveLayoutPreferences(next,nextEncoders);layouts=next;encoders=nextEncoders;setLayouts(layouts);setEncoders(encoders);draw();$('layoutMessage').textContent='既定の割り当てに戻しました。';}catch(e){$('layoutMessage').textContent=e.message;}
 });

 draw();
}
