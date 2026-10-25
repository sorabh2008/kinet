import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createKinetServer, TOOL_DEFINITIONS } from './server.js';
import { localTools } from './tools/local.js';

const CORE_TOOL_NAMES = [
  'kinet_web_search', 'kinet_github_search', 'kinet_get_context', 'kinet_get_rules', 'kinet_get_prp',
  'kinet_memory_recall', 'kinet_memory_save', 'kinet_get_skill', 'kinet_validate',
];
const EXPECTED_TOOL_COUNT = 12;

function silentLog() {
  const calls = [];
  return { calls, info() {}, warn() {}, error() {}, tool: (...args) => calls.push(args) };
}

async function connectClient(log = silentLog()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createKinetServer({ log }).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

test('tools/list keeps the 9 core tools first and adds the local tools (AC-0.1)', async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  assert.equal(tools.length, EXPECTED_TOOL_COUNT);
  assert.equal(TOOL_DEFINITIONS.length, EXPECTED_TOOL_COUNT);
  assert.deepEqual(tools.slice(0, 9).map((t) => t.name), CORE_TOOL_NAMES);
  for (const tool of tools.slice(9)) {
    assert.ok(tool.name.startsWith('kinet_'), tool.name);
    assert.ok(tool.description.length > 10, tool.name);
    assert.equal(tool.inputSchema.type, 'object', tool.name);
  }
  assert.equal(localTools.length, EXPECTED_TOOL_COUNT - 9);
  await client.close();
});

test('every tool call is logged by name and outcome, never by argument', async () => {
  const log = silentLog();
  const client = await connectClient(log);
  const result = await client.callTool({ name: 'kinet_no_such_tool', arguments: { secret: 'SECRET_ARG' } });
  assert.equal(result.isError, true);
  assert.equal(log.calls.length, 1);
  const [name, ms, ok] = log.calls[0];
  assert.equal(name, 'kinet_no_such_tool');
  assert.equal(typeof ms, 'number');
  assert.equal(ok, false);
  assert.equal(JSON.stringify(log.calls).includes('SECRET_ARG'), false);
  await client.close();
});
