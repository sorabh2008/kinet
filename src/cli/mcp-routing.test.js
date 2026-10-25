import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BIN_PATH, REPO_ROOT, tempDir } from '../test-support/helpers.js';
import { TOOL_DEFINITIONS } from '../mcp/server.js';

test('bare `kinet mcp` serves MCP over stdio with only protocol on stdout (AC-6.1, AC-6.3)', async () => {
  const cwd = await tempDir();
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN_PATH, 'mcp'], cwd, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
  const client = new Client({ name: 'test', version: '0' });
  const errors = [];
  client.onerror = (err) => errors.push(err);

  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, TOOL_DEFINITIONS.length);
  await client.close();

  assert.deepEqual(errors, []);
  assert.match(stderr, /INFO start mode=stdio/);
});

test('`kinet init` still configures clients with args [\'mcp\'] (AC-6.4)', async () => {
  const source = await readFile(join(REPO_ROOT, 'src', 'cli', 'init.js'), 'utf8');
  assert.ok(source.includes("args: ['mcp']"));
});
