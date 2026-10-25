import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './test-support/helpers.js';
import { TOOL_DEFINITIONS } from './mcp/server.js';

const readme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8');

test('README MCP Tools table lists every tool (AC-0.7)', () => {
  const table = readme.slice(readme.indexOf('## MCP Tools'));
  assert.equal(TOOL_DEFINITIONS.length, 14);
  for (const { name } of TOOL_DEFINITIONS) assert.ok(table.includes(`| \`${name}\` |`), name);
});

test('README documents the lifecycle commands and localhost binding (AC-11.3)', () => {
  for (const cmd of ['kinet mcp start', 'kinet mcp stop', 'kinet mcp status', 'kinet mcp logs']) {
    assert.ok(readme.includes(cmd), cmd);
  }
  assert.ok(readme.includes('127.0.0.1'));
  assert.ok(readme.includes('7345'));
});
