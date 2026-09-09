import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { fixture, create, track } from './helpers.mjs';

test('real MCP stdio client discovers tools and creates/edits/renders a project', async t => {
  const { root } = await fixture(t);
  const client = new Client({ name: 'aidaw-integration-test', version: '1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp.js')],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)), AIDAW_HOME: root }, stderr: 'pipe' });
  await client.connect(transport); t.after(() => client.close());
  const list = await client.listTools(); assert.ok(list.tools.some(t => t.name === 'project_apply'));
  async function api(name, args) {
    const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text);
  }
  const caps = await api('system_capabilities', {}); assert.ok(caps.formats.includes('VST3'));
  await api('project_create', create);
  await api('project_apply', { project_id: 'song', base_revision: 0, request_id: 'mcp-edit', operations: [{ op: 'add_track', track }] });
  const j = await api('render_start', { project_id: 'song' });
  let result;
  for (let i = 0; i < 600; i++) {
    result = await api('job_status', { job_id: j.job_id });
    if (!['queued', 'running'].includes(result.state)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(result.state, 'succeeded', result.error); assert.equal(result.analysis.silent, false);
  const bad = await client.callTool({ name: 'project_apply', arguments: { project_id: 'song', base_revision: 0, request_id: 'stale', operations: [{ op: 'set_bpm', bpm: 90 }] } });
  assert.equal(bad.isError, true);
});
