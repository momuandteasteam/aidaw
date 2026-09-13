import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { call } from '../../Application/api.js';
import { negotiateApplication,type ApplicationPort } from '../../Contracts/application-contract.js';

export function createMcpServer(application:ApplicationPort) {
negotiateApplication(application);
const server = new McpServer({ name: 'aidaw', version: '0.1.0' }, {
  instructions: application.instructions,
});
for (const [name, definition] of Object.entries(application.definitions)) {
  server.registerTool(name, {
    description: definition.description,
    inputSchema: definition.schema.shape,
  }, async (args: unknown) => {
    try { const result = await call(application, name, args); return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
  });
}
return server;
}
