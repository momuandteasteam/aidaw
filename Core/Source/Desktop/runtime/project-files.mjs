/** File workflows use the same application API as AI clients. */
export function projectFiles({api,host,getState,stop,reload,chooseProject,refresh,id=()=>crypto.randomUUID(),delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 const title=path=>path.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');
 const assetId=a=>a.asset_id??a.id??a.asset?.id;
 async function addSong(project,path,name){
  const asset=await api('file_import',{project_id:project,path});
  const doc=await api('project_document',{project_id:project});
  await api('mastering_add_song',{project_id:project,base_revision:doc.revision,request_id:id(),song_id:id(),name,asset_id:assetId(asset),effects:[]});
 }
 async function importAudio(){
  const s=getState(),project=s.projectId,kind=s.document?.kind;
  if(!project||!['composition','mastering'].includes(kind))return;
  let paths=await host.chooseAudioFiles();if(!paths?.length)return;
  const images=paths.filter(p=>/\.(png|jpe?g)$/i.test(p));
  if(images.length>1){const choice=await host.form('カバーアートを選択',[{name:'cover',label:'使用する画像',value:images[0],options:images.map(p=>({value:p,label:p.split(/[\\/]/).pop()}))}],'取り込む');if(!choice)return;paths=paths.filter(p=>!images.includes(p)||p===choice.cover);}
  await stop();let count=0;const failures=[];
  for(const path of paths){try{if(kind==='mastering'&&!/\.(png|jpe?g)$/i.test(path))await addSong(project,path,title(path));else await api('file_import',{project_id:project,path});count++;}catch(e){failures.push(`${title(path)}: ${e.message}`);}}
  await reload();host.notify?.(`${count}件のファイルを取り込みました。${failures.length?'\n取り込み失敗:\n'+failures.join('\n'):''}`);
 }
 async function wait(job){
  for(;;){const status=await api('job_status',{job_id:job.job_id});if(status.state==='succeeded')return status;if(['failed','cancelled'].includes(status.state))throw Error(status.error??'音声処理が中止されました');await delay(500);}
 }
 async function send(kind){
  const s=getState();if(s.document?.kind!=='composition')return;
  const source=s.projectId,name=s.document.name;
  const projects=kind==='mastering'?(await api('project_list',{})):[];
  const rows=Array.isArray(projects)?projects:projects.projects??[];
  const data=await host.form(kind==='mastering'?'マスタリングへ送る':'ステム分離へ送る',[
   ...(kind==='mastering'?[{name:'destination',label:'送信先',value:'new',options:[{value:'new',label:'新規マスタリングプロジェクト'},...rows.filter(p=>p.kind==='mastering').map(p=>({value:p.project_id,label:p.name}))]}]:[]),
   {name:'name',label:'新規プロジェクト名',value:`${name} · ${kind==='mastering'?'マスタリング':'ステム分離'}`,required:true}
  ],'送る');if(!data)return;
  await stop();host.notify?.('楽曲をレンダリングしています…');
  const rendered=await wait(await api('render_start',{project_id:source,request_id:id()}));
  const file=rendered.files?.find(f=>f.format==='wav'||/\.wav$/i.test(f.path??f.output??''));
  const path=rendered.output??file?.path??file?.output;
  if(!path)throw Error('レンダリング結果のWAVが見つかりません');
  const target=data.destination&&data.destination!=='new'?data.destination:id();
  try{
   if(!data.destination||data.destination==='new')await api('project_create',{project_id:target,name:data.name,kind});
   if(kind==='mastering')await addSong(target,path,name);
   else{
    const asset=await api('asset_import',{project_id:target,path,role:'source'}),doc=await api('project_document',{project_id:target});
    host.notify?.('ステム分離しています…');
    await wait(await api('separation_start',{project_id:target,source_asset_id:assetId(asset),base_revision:doc.revision,request_id:id()}));
   }
   await refresh();await chooseProject(target);host.notify?.('送信先のプロジェクトを開きました。');
  }catch(e){throw Error(`${e.message}\n送信先: ${target}`);}
 }
 return {importAudio,send};
}
