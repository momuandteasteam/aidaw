import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const output=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z']);
const files=output.toString('utf8').split('\0').filter(Boolean);
const forbidden=new Set(['.env','.mcp.json','.codex/config.toml','catalog/observed-plugins.json']);
const textExtensions=new Set(['','.c','.cc','.cpp','.h','.hpp','.js','.json','.md','.mjs','.ps1','.sh','.toml','.ts','.txt','.yml','.yaml']);
const findings=[];

for(const file of files){
  if(forbidden.has(file)||file.startsWith('.aidaw/')||file.startsWith('outputs/'))findings.push(`${file}: private/generated path`);
  let info;
  try{info=await stat(file);}catch(error){if(error?.code==='ENOENT')continue;throw error;}
  if(info.size>10*1024*1024)findings.push(`${file}: ${info.size} bytes exceeds the 10 MiB source limit`);
  if(!textExtensions.has(extname(file).toLowerCase()))continue;
  const text=await readFile(file,'utf8');
  if(/\/Users\/(?!Shared(?:\/|:)|yourname\/|\.\.\.\/)[^/\s"']+\//.test(text)||/Mobile Documents\/com~apple/.test(text))findings.push(`${file}: developer-specific macOS path`);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))findings.push(`${file}: private key material`);
  if(/(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][A-Za-z0-9_\-\/+=.]{20,}["']/i.test(text))findings.push(`${file}: credential-like assignment`);
}

if(findings.length){
  console.error('Public-source check failed:\n'+findings.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log(`Public-source check passed (${files.length} candidate files).`);
