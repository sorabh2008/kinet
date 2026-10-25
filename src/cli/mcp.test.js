import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { formatUptime, lastLines, abortStart, runMcpStop } from './mcp.js';
import { acquireLock, ensureRunDir, runPaths, isPidAlive, writeState, readState } from '../mcp/runstate.js';
import { tempDir, waitFor, freePort } from '../test-support/helpers.js';

test('formatUptime', () => {
  assert.equal(formatUptime(45_000), '45s');
  assert.equal(formatUptime(192_000), '3m 12s');
  assert.equal(formatUptime((2 * 3600 + 5 * 60) * 1000), '2h 5m');
  assert.equal(formatUptime((27 * 3600) * 1000), '1d 3h');
  assert.equal(formatUptime(-5), '0s');
});

test('lastLines', () => {
  assert.equal(lastLines('a\nb\nc\n', 2), 'b\nc\n');
  assert.equal(lastLines('a\nb\nc', 5), 'a\nb\nc\n');
  assert.equal(lastLines('', 5), '');
});

test('abortStart kills the detached child and removes the lock (review-2 finding 2)', { skip: process.platform === 'win32' }, async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  const release = await acquireLock(cwd);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore' });
  await waitFor(() => isPidAlive(child.pid));
  abortStart(child, release);
  await waitFor(() => !isPidAlive(child.pid), 3000);
  await waitFor(() => !existsSync(runPaths(cwd).lock), 3000);
});

// A fake daemon that passes the identity check but ignores /shutdown.
const STUBBORN_SERVER = `
const http = require('http');
const [port, token] = process.argv.slice(1);
http.createServer((req, res) => {
  if (req.headers['x-kinet-token'] !== token) return res.writeHead(401).end();
  if (req.url === '/health') return res.end(JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
  res.writeHead(202).end();
}).listen(Number(port), '127.0.0.1', () => process.stdout.write('ready'));
`;

async function captureStdout(fn) {
  const original = process.stdout.write;
  let text = '';
  process.stdout.write = (chunk) => { text += chunk; return true; };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return text;
}

test('stop force-kills a server that ignores /shutdown (AC-9.1, R3-3b)', { skip: process.platform === 'win32' }, async () => {
  const cwd = await tempDir();
  const port = await freePort();
  const token = 'c'.repeat(64);
  const child = spawn(process.execPath, ['-e', STUBBORN_SERVER, String(port), token], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  let ready = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { ready += d; });
  await waitFor(() => ready === 'ready');

  await ensureRunDir(cwd);
  await writeState(cwd, { pid: child.pid, port, token, cwd, startedAt: new Date().toISOString(), logPath: runPaths(cwd).log });
  const output = await captureStdout(() => runMcpStop({ cwd, graceMs: 300, pollMs: 50 }));

  assert.equal(output, `stopped (pid ${child.pid}, force-killed after 0.3 s)\n`);
  await waitFor(() => !isPidAlive(child.pid), 3000);
  assert.equal(await readState(cwd), null);
});
