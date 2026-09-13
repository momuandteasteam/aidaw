// Development fixtures are explicit test inputs, never production home fallbacks.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const env={...process.env,AIDAW_ENGINE:process.env.AIDAW_ENGINE??fileURLToPath(new URL(`../Build/Native/bin/aidaw-engine${process.platform==='win32'?'.exe':''}`,import.meta.url)),AIDAW_SOUNDFONT:process.env.AIDAW_SOUNDFONT??fileURLToPath(new URL('../Build/Native/starter-assets/FluidR3_GM.sf2',import.meta.url))};
const child=spawn(process.execPath,['--test',...process.argv.slice(2)],{cwd:root,env,stdio:'inherit',shell:false});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
