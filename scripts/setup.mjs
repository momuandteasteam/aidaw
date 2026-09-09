// Dependency-free entrypoint: npm ci runs before the config parser is imported.
import {spawnSync} from 'node:child_process';
import {access,realpath,mkdir,writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir,cpus} from 'node:os';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(2);let client='both',dataDir=join(root,'.aidaw'),configureOnly=false,check=false;
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--client'){client=argv[++i];if(!['codex','claude','both','none'].includes(client))throw Error('Invalid --client');}
 else if(argv[i]==='--data-dir'){if(!argv[i+1])throw Error('Missing --data-dir');dataDir=resolve(argv[++i]);}
 else if(argv[i]==='--configure-only')configureOnly=true;
 else if(argv[i]==='--check')check=true;
 else if(argv[i]==='--help'){console.log('node scripts/setup.mjs [--client codex|claude|both|none] [--data-dir PATH] [--configure-only] [--check]');process.exit(0);}
 else throw Error(`Unknown argument: ${argv[i]}`);
}
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error('Node >=22.13 required. Run scripts/setup.sh or scripts/setup.ps1.');
if(!['darwin','win32'].includes(process.platform))throw Error('This setup supports native macOS and Windows. WSL/Linux cannot host the Windows VST3 build.');
function run(command,args,options={}){
 console.log(`[setup] ${command} ${args.join(' ')}`);
 const r=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false,...options});
 if(r.error||r.status!==0)throw Error(`Command failed (${r.status}): ${command}: ${r.error?.message??''}`);
}
function locate(name){
 const override=name==='ffmpeg'?process.env.AIDAW_FFMPEG:name==='ffprobe'?process.env.AIDAW_FFPROBE:undefined;
 if(override){const r=spawnSync(override,['-version'],{stdio:'ignore'});return !r.error&&r.status===0?resolve(override):null;}
 const dirs=[...process.env.PATH?.split(delimiter)??[],...(process.platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin']:[])];
 for(const dir of dirs){const path=join(dir,process.platform==='win32'?`${name}.exe`:name);const r=spawnSync(path,[name==='ffmpeg'||name==='ffprobe'?'-version':'--version'],{stdio:'ignore'});if(!r.error&&r.status===0)return path;}
 return null;
}
const paths={cmake:locate('cmake'),ffmpeg:locate('ffmpeg'),ffprobe:locate('ffprobe')};
const missing=Object.entries(paths).filter(([,v])=>!v).map(([k])=>k);
if(missing.length)throw Error(`Missing ${missing.join(', ')}. Run scripts/setup.sh (Mac) or scripts/setup.ps1 (Windows), then retry.`);
if(process.platform==='darwin'){const r=spawnSync('/usr/bin/xcrun',['--find','clang++'],{stdio:'ignore'});if(r.status!==0)throw Error('Xcode Command Line Tools required. Run xcode-select --install; complete OS installer then retry.');}
if(check){console.log(JSON.stringify({ready:true,root,node:process.execPath,...paths},null,2));process.exit(0);}
const base=join(dataDir,'Setup.aidaw'),job=join(base,'jobs',randomUUID());
for(const d of ['assets','state','jobs','outputs','temp'])await mkdir(join(base,d),{recursive:true});
await mkdir(job,{recursive:true});
const report={state:'running',started_at:new Date().toISOString(),root,client,job,steps:[]};
const record=async()=>{await writeFile(join(job,'report.json'),JSON.stringify(report,null,2));await writeFile(join(base,'state','last-setup.json'),JSON.stringify(report,null,2));};
await record();
try{
 const {installStarter,registerStarter}=await import('./setup/starter.mjs');
 report.starter_bank=await installStarter(join(root,'build'));report.steps.push('starter_bank');
 if(!configureOnly){
  // Use npm's JS entrypoint with Node, avoiding Windows .cmd shell quoting.
  const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...((process.env.PATH??'').split(delimiter).map(d=>process.platform==='win32'?join(d,'node_modules/npm/bin/npm-cli.js'):join(d,'npm'))) ].filter(Boolean);
  let npm;for(const candidate of candidates){try{await access(candidate);npm=await realpath(candidate);break;}catch{}}
  if(!npm)throw Error('npm JavaScript entrypoint not found. Install Node with npm or invoke npm run setup.');run(process.execPath,[npm,'ci']);report.steps.push('npm_ci');
  run(paths.cmake,['-S',root,'-B',join(root,'build'),'-DCMAKE_BUILD_TYPE=Release']);
  run(paths.cmake,['--build',join(root,'build'),'--config','Release','--parallel',String(Math.min(4,cpus().length))]);
  run(process.execPath,[npm,'run','build']);report.steps.push('build');
  run(process.execPath,['--test','tests/mcp.test.mjs','tests/content.test.mjs','tests/starter.test.mjs']);report.steps.push('mcp_content_and_starter_audio_tests');
 }
 const engine=join(root,'build','bin',`aidaw-engine${process.platform==='win32'?'.exe':''}`);await access(engine);await access(join(root,'dist','mcp.js'));
 const env={AIDAW_HOME:dataDir,AIDAW_ENGINE:engine,AIDAW_FFMPEG:paths.ffmpeg,AIDAW_FFPROBE:paths.ffprobe};
 // Verify a real stdio handshake and tool call, even in configure-only mode.
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const scratch=await mkdtemp(join(tmpdir(),'aidaw-setup-'));const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'dist','mcp.js')],env:{...process.env,...env,AIDAW_HOME:scratch},stderr:'inherit'});const mcp=new Client({name:'aidaw-setup',version:'1.0.0'});
 try{await mcp.connect(transport);const tools=await mcp.listTools();if(!tools.tools.some(t=>t.name==='content_search'))throw Error('Incomplete MCP tool catalog');const result=await mcp.callTool({name:'system_capabilities',arguments:{}});if(result.isError)throw Error(JSON.stringify(result));report.capabilities=JSON.parse(result.content[0].text);report.steps.push('stdio_handshake_and_engine');}finally{await mcp.close();await rm(scratch,{recursive:true,force:true});}
 const {Service}=await import('../dist/service.js');const {ContentCatalog}=await import('../dist/content.js');const service=new Service(dataDir);
 try{report.starter_plugins=await registerStarter(service,join(root,'build'));report.steps.push('starter_plugins');const content=new ContentCatalog(service);const discovered=await content.discover();report.content_roots=discovered.roots.length;report.discovery_gaps=discovered.gaps;report.content_index=await content.index([],50000,30);report.steps.push('content_index');}finally{await service.close();}
 const {planConfigs,applyConfigs}=await import('./setup/config.mjs');
 const plans=await planConfigs({root,client,node:process.execPath,env});report.configs=await applyConfigs(plans,join(job,'config-backups'));report.steps.push('project_mcp_configuration');
 report.state='succeeded';report.activation='Client reload / new session and native project MCP trust may be required. Not yet verified inside the running client.';await record();
 console.log(`[setup] Complete. Report: ${join(job,'report.json')}\nReload Codex / Claude Code to load the project MCP configuration. Initial project trust may require user action. No instrument has been auditioned by setup.`);
}catch(e){report.state='failed';report.error=String(e);await record();console.error(`[setup] ${e.message}\nReport: ${join(job,'report.json')}`);process.exitCode=1;}
