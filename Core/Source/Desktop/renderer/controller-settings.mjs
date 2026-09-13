
import {listControllerProfiles,getControllerProfile,createControllerAdapter} from '../../../../Plugins/Controllers/index.mjs';

export function setupControllerSettings({getState,dispatch,onError,preferences}){
 const $=id=>document.getElementById(id);
 let access=null,port=null,learning=null,config={profile:'',input:'',mappings:[],...preferences},adapter=null;
 for(const p of listControllerProfiles())$('controllerProfile').add(new Option(p.name??p.label??p.id,p.id));
 for(let i=0;i<8;i++)$('learnTarget').add(new Option(`キー ${i+1}（左上4×2）`,`key:${i}`));
 for(let i=0;i<4;i++)$('learnTarget').add(new Option(`ノブ ${i+1}`,`encoder:${i}`));
 $('controllerProfile').value=config.profile;
 const save=()=>window.aidaw.saveControllerPreferences(config).catch(onError);
 function activate(){
  if(config.profile&&!getControllerProfile(config.profile))config.profile='';
  adapter=config.profile?createControllerAdapter(config.profile,{mappings:config.mappings}):null;
  const p=config.profile?getControllerProfile(config.profile):null,midi=p?.transport==='midi';
  $('controllerStatus').textContent=!p?'機器を選択してください。':midi?'MIDI Learnでキーとノブを割り当てます。機種側もMIDI／Userモードに設定してください。':'専用ブリッジが必要です。機種別スクリプトは controllers に分離されています。';
  for(const id of ['connectMidi','midiInput','learnTarget','encoderMode','learnMidi','clearMidi'])$(id).disabled=!midi;
  learning=null;if(port){port.onmidimessage=null;port=null;}
  if(midi&&access){port=access.inputs.get(config.input);if(port?.state==='connected')port.onmidimessage=receive;else port=null;}
 }
 function receive(event){
  if(!adapter)return;
  if(learning){const mapping=adapter.learn(event.data,learning);if(mapping){config.mappings=adapter.getMappings();learning=null;$('midiStatus').textContent='割り当てを保存しました。';void save();}return;}
  const command=adapter.handleMidi(event.data,getState());if(command)void dispatch(command);
 }
 function inputs(){
  $('midiInput').replaceChildren(new Option('入力を選択',''));
  if(access)for(const input of access.inputs.values())if(input.state==='connected')$('midiInput').add(new Option(input.name??input.id,input.id));
  $('midiInput').value=config.input;activate();
  $('midiStatus').textContent=port?'接続済み':config.input?'MIDI入力が見つかりません。':'MIDI入力を選択してください。';
 }
 $('controllerProfile').addEventListener('change',()=>{config={profile:$('controllerProfile').value,input:'',mappings:[]};activate();void save();});
 $('connectMidi').addEventListener('click',async()=>{try{if(!navigator.requestMIDIAccess)throw new Error('この環境ではWeb MIDIを利用できません。');access=await navigator.requestMIDIAccess({sysex:false});access.onstatechange=inputs;inputs();}catch(e){$('midiStatus').textContent=e.message;}});
 $('midiInput').addEventListener('change',()=>{config.input=$('midiInput').value;activate();void save();});
 $('learnMidi').addEventListener('click',()=>{if(!port){$('midiStatus').textContent='先にMIDI入力を接続してください。';return;}const [kind,index]=$('learnTarget').value.split(':');learning={kind,index:Number(index),...(kind==='encoder'?{mode:$('encoderMode').value}:{})};$('midiStatus').textContent='機器のキーを押すか、ノブを回してください。';});
 $('clearMidi').addEventListener('click',()=>{config.mappings=[];activate();$('midiStatus').textContent='割り当てをクリアしました。';void save();});
 activate();
 return {dispose(){if(port)port.onmidimessage=null;if(access)access.onstatechange=null;}};
}
