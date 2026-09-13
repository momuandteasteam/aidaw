import {readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
const canonical=path=>path?(process.platform==='win32'?resolve(path).replaceAll('\\','/').toLowerCase():resolve(path)):undefined;
/** CMake caches contain absolute paths. Preserve downloaded sources and bank when the checkout moves. */
export async function prepareNativeCache(sourceRoot,buildRoot){
 let changed=false,cache;
 try{cache=await readFile(join(buildRoot,'CMakeCache.txt'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(cache){
  const source=cache.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m)?.[1],directory=cache.match(/^CMAKE_CACHEFILE_DIR:INTERNAL=(.*)$/m)?.[1];
  if(canonical(source)!==canonical(sourceRoot)||canonical(directory)!==canonical(buildRoot)){for(const path of ['CMakeCache.txt','CMakeFiles','_deps/juce-build','_deps/juce-subbuild'])await rm(join(buildRoot,path),{recursive:true,force:true});changed=true;}
 }
 // JUCE creates independent helper CMake builds beneath each plugin's artifacts.
 for(const folder of ['starter','test-fixtures']){
  const base=join(buildRoot,folder);let entries;try{entries=await readdir(base,{recursive:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const entry of entries){if(!entry.endsWith('CMakeCache.txt'))continue;const path=join(base,entry),directory=dirname(path),text=await readFile(path,'utf8'),stored=text.match(/^CMAKE_CACHEFILE_DIR:INTERNAL=(.*)$/m)?.[1];if(canonical(stored)!==canonical(directory)){await rm(path,{force:true});await rm(join(directory,'CMakeFiles'),{recursive:true,force:true});changed=true;}}
 }
 return changed;
}
