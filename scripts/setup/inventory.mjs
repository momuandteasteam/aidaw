import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Service } from '../../dist/service.js';
import { PluginInventory } from '../../dist/plugin-inventory.js';

const argv=process.argv.slice(2);let resume,seconds=600,output=resolve(process.env.AIDAW_HOME??'.aidaw','PluginLibrary.aidaw','outputs','portable-plugin-catalog.json');
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--resume')resume=argv[++i];
 else if(argv[i]==='--max-seconds')seconds=Number(argv[++i]);
 else if(argv[i]==='--output')output=resolve(argv[++i]);
 else if(argv[i]==='--help'){console.log('npm run inventory:plugins -- [--resume JOB_ID] [--max-seconds N] [--output PATH]');process.exit(0);}
 else throw Error(`Unknown argument: ${argv[i]}`);
}
if(!Number.isInteger(seconds)||seconds<1||seconds>3600)throw Error('--max-seconds must be an integer from 1 to 3600');
const service=new Service();
try{
 const inventory=new PluginInventory(service),formats=process.platform==='darwin'?['VST3','AudioUnit']:['VST3'];
 let result=await inventory.start(formats,seconds,resume);console.log(JSON.stringify(result.summary,null,2));
 while(result.state==='paused'){
  console.log(`[inventory] Resuming ${result.id}`);result=await inventory.start([],seconds,result.id);console.log(JSON.stringify(result.summary,null,2));
 }
 await mkdir(dirname(output),{recursive:true});await cp(result.portable_catalog,output);
 const portable=JSON.parse(await readFile(output,'utf8'));
 console.log(JSON.stringify({state:result.state,job_id:result.id,local_database:service.root+'/PluginLibrary.aidaw/state/catalog.sqlite',portable_catalog:output,plugins:portable.plugins.length,failures:portable.failures.length},null,2));
 if(result.state!=='succeeded')process.exitCode=1;
}finally{await service.close();}
