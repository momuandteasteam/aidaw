import {releaseVersion} from '../../../Build/JS/Contracts/release.js';
export function setupVersions(bridge){
 const $=id=>document.getElementById(id),button=$('versionButton'),dialog=$('versionsDialog');let generation=0;
 button.textContent=`v${releaseVersion}`;
 async function open(){const token=++generation;$('versionsList').replaceChildren();$('versionsStatus').textContent='取得中…';dialog.showModal();
  try{const data=await bridge.api('system_versions',{});if(token!==generation||!dialog.open)return;
   for(const [category,title] of [['core','AIDAW・コア'],['builtin','内蔵音源・エフェクト'],['technology','技術スタック・ライブラリ']]){
    const members=data.components.filter(c=>(['core','builtin','technology'].includes(c.category)?c.category:'technology')===category);if(!members.length)continue;
    const section=document.createElement('section'),heading=document.createElement('h3');section.className='version-group';heading.textContent=title;section.append(heading);$('versionsList').append(section);
   for(const component of members){const row=document.createElement('div');row.className='version-row';const name=document.createElement('span'),version=document.createElement('span'),status=document.createElement('small');name.textContent=component.name;version.textContent=component.version??'未確認';status.textContent={running:'実行中',installed:'導入済み',unknown:'未確認'}[component.status]??'未確認';row.append(name,version,status);section.append(row);}
   }
   $('versionsStatus').textContent='';
  }catch(e){if(token===generation&&dialog.open)$('versionsStatus').textContent=`取得できません: ${e.message}`;}
 }
 const close=()=>dialog.close(),closed=()=>{generation++;button.focus();};button.addEventListener('click',open);$('versionsClose').addEventListener('click',close);dialog.addEventListener('close',closed);
 return {dispose(){generation++;button.removeEventListener('click',open);$('versionsClose').removeEventListener('click',close);dialog.removeEventListener('close',closed);}};
}
