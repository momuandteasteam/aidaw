import { instrumentSelectionInstructions } from './instrument-policy.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { definitions, call } from './api.js';
import { Service } from './service.js';

export function createMcpServer(service:Service) {
const server = new McpServer({ name: 'aidaw', version: '0.1.0' }, {
  instructions: instrumentSelectionInstructions + '\n' + 'All paths returned by tools are SERVER paths, never paths on a remote client. HTTP clients upload to POST /uploads, then use the returned path with asset_import/midi_import/bundle_import. Download authorized artifacts with GET /files?path=<encoded server path> using the same bearer token. Local stdio clients can use paths directly. Keep plugin loading, latency compensation, parameter state, rendering and packaging on this server. Use system_capabilities first. Search/scan available plugins before choosing sounds. Read project revision before edits; use request_id for retry safety. Compose concrete notes at PPQ 960. Preserve unaffected tracks and ranges. Render, poll the job, and inspect measurements before claiming success. Sample peak/RMS are not mastering quality. AU is macOS-only; do not substitute missing plugins silently. sound_probe returns an audio file for YOU, the calling tool, to audition; sound_assess stores your assessment. Use caller_audio_review only after actually accessing audio, otherwise metadata_inference. No external audio model is called by this server.',
});
for (const [name, definition] of Object.entries(definitions)) {
  server.registerTool(name, {
    description: definition.description,
    inputSchema: definition.schema.shape,
  }, async (args: unknown) => {
    try { const result = await call(service, name, args); return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
  });
}
return server;
}
