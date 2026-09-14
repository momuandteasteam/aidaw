import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readObservation,saveObservation} from '../Build/JS/Adapters/node/catalog/catalog-contribution.js';
const [command,path,...extra]=process.argv.slice(2);
if(command!=='accept'||!path||extra.length)throw Error('Usage: node Core/Tools/catalog-contribution.mjs accept <reviewed JSON>');
const root=fileURLToPath(new URL('../../',import.meta.url));
console.log(JSON.stringify(await saveObservation(join(root,'Libraries','Catalog','Contributions'),await readObservation(path)),null,2));
