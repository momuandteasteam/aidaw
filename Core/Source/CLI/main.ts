import { readFile } from 'node:fs/promises';
import { call } from '../Application/api.js';
import { createLocalApplication } from '../Application/local-application.js';
import { Service } from '../Application/service.js';

const service = new Service();
const application=createLocalApplication(service);
try {
  const [command, source] = process.argv.slice(2);
  if (!command || command === '--help') console.log(`AIDAW: node Core/Build/JS/CLI/main.js <tool> <arguments.json>\n${Object.keys(application.definitions).join('\n')}\nrender_start waits to finish in CLI mode. MCP mode runs asynchronously.`);
  else {
    const input = source ? JSON.parse(await readFile(source, 'utf8')) : {};
    const result = await call(application, command, input);
    const output = command === 'render_start' ? await service.wait(result.job_id) : result;
    console.log(JSON.stringify(output, null, 2));
    if (output?.state === 'failed' || output?.state === 'cancelled') process.exitCode = 1;
  }
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
finally { await service.close(); }
