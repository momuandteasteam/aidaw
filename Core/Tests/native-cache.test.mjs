import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareNativeCache} from '../Tools/native-cache.mjs';
test('relocated native cache clears absolute build metadata and preserves downloads and bank',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidaw-native-cache-')),source=join(root,'Source'),build=join(root,'Native');t.after(()=>rm(root,{recursive:true,force:true}));
 for(const folder of ['CMakeFiles','_deps/juce-src','_deps/juce-build','_deps/juce-subbuild','starter-assets','starter/plugin/JuceLibraryCode/vst3_helper/CMakeFiles'])await mkdir(join(build,folder),{recursive:true});
 await writeFile(join(build,'starter/plugin/JuceLibraryCode/vst3_helper/CMakeCache.txt'),'CMAKE_CACHEFILE_DIR:INTERNAL=/old/helper\n');
 await writeFile(join(build,'CMakeCache.txt'),'CMAKE_HOME_DIRECTORY:INTERNAL=/old/source\nCMAKE_CACHEFILE_DIR:INTERNAL=/old/build\n');await writeFile(join(build,'_deps/juce-src','source.txt'),'preserve');await writeFile(join(build,'starter-assets','bank'),'preserve');
 assert.equal(await prepareNativeCache(source,build),true);await assert.rejects(access(join(build,'CMakeCache.txt')));await assert.rejects(access(join(build,'_deps/juce-build')));await assert.rejects(access(join(build,'starter/plugin/JuceLibraryCode/vst3_helper/CMakeCache.txt')));assert.equal(await readFile(join(build,'_deps/juce-src','source.txt'),'utf8'),'preserve');assert.equal(await readFile(join(build,'starter-assets','bank'),'utf8'),'preserve');
 await writeFile(join(build,'CMakeCache.txt'),`CMAKE_HOME_DIRECTORY:INTERNAL=${source}\nCMAKE_CACHEFILE_DIR:INTERNAL=${build}\n`);assert.equal(await prepareNativeCache(source,build),false);await access(join(build,'CMakeCache.txt'));
});
