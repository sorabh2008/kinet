import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { BIN_PATH, REPO_ROOT, tempDir, freePort, waitFor, runCli } from '../test-support/helpers.js';
import { parsePort } from '../utils/args.js';
import { TOOL_DEFINITIONS } from '../mcp/server.js';

const VALID_SUBCOMMANDS = 'start, stop, status, logs';

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

function httpStatus(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.once('error', reject);
    req.end();
  });
}

async function startForeground(port, cwd) {
  const child = spawn(process.execPath, [BIN_PATH, 'mcp', '--port', String(port)], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
  await waitFor(() => stderr.includes('listening'), 5000);
  return { child, stderr: () => stderr };
}

async function sseClient(port) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`)));
  return client;
}

test('`kinet mcp --port` serves two SSE clients at once and guards the routes (AC-6.2)', async () => {
  const port = await freePort();
  const { child, stderr } = await startForeground(port, await tempDir());
  try {
    const [a, b] = await Promise.all([sseClient(port), sseClient(port)]);
    const [listA, listB] = await Promise.all([a.listTools(), b.listTools()]);
    assert.equal(listA.tools.length, TOOL_DEFINITIONS.length);
    assert.equal(listB.tools.length, TOOL_DEFINITIONS.length);
    await Promise.all([a.close(), b.close()]);

    assert.equal(await httpStatus(port, '/health'), 404);
    assert.equal(await httpStatus(port, '/sse', { host: 'evil.example' }), 403);
    assert.equal(await httpStatus(port, '/sse', { origin: 'http://evil.example' }), 403);
    assert.match(stderr(), /INFO start mode=http port=\d+/);
    assert.match(stderr(), new RegExp(`INFO listening http://127\\.0\\.0\\.1:${port}/sse`));
  } finally {
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
  }
  assert.match(stderr(), /WARN shutdown reason=SIGTERM/);
});

test('`kinet mcp --help` lists the subcommands and explains stdio mode (AC-6.5)', async () => {
  const { code, stdout } = await runCli(['mcp', '--help']);
  assert.equal(code, 0);
  for (const word of ['start', 'stop', 'status', 'logs', 'stdio']) assert.ok(stdout.includes(word), word);
});

test('an unknown subcommand exits non-zero and names the valid ones (AC-6.6)', async () => {
  const started = Date.now();
  const { code, stderr } = await runCli(['mcp', 'foo'], { cwd: await tempDir() });
  assert.notEqual(code, 0);
  assert.ok(Date.now() - started < 3000);
  assert.match(stderr, /unknown subcommand 'foo'/);
  assert.match(stderr, new RegExp(`Valid: ${VALID_SUBCOMMANDS}`));
});

test('parent --port is refused for subcommands other than start', async () => {
  const { code, stderr } = await runCli(['mcp', '--port', '1', 'status'], { cwd: await tempDir() });
  assert.notEqual(code, 0);
  assert.match(stderr, /--port only applies/);
});

test('--port must be an integer 1-65535', async () => {
  assert.throws(() => parsePort('80abc'));
  const { code, stderr } = await runCli(['mcp', '--port', '80abc'], { cwd: await tempDir() });
  assert.notEqual(code, 0);
  assert.match(stderr, /must be an integer 1-65535/);
});
