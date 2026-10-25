import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { formatUptime, lastLines, abortStart, runMcpStop } from './mcp.js';
import { acquireLock, ensureRunDir, runPaths, isPidAlive, writeState, readState } from '../mcp/runstate.js';
import { tempDir, waitFor, freePort, writeFiles } from '../test-support/helpers.js';
import { join } from 'node:path';

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

test('abortStart kills the detached child and removes our lock (review-2 finding 2, BUG-1)', { skip: process.platform === 'win32' }, async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore' });
  await waitFor(() => isPidAlive(child.pid));
  const session = { aborted: false, child, lockPromise: acquireLock(cwd) };
  await abortStart(session);
  assert.equal(session.aborted, true);
  assert.equal(existsSync(runPaths(cwd).lock), false);
  await waitFor(() => !isPidAlive(child.pid), 3000);
});

test('abortStart never throws when the kill fails with EPERM and still removes our lock (BUG-2)', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  const eperm = () => {
    const err = new Error('kill EPERM');
    err.code = 'EPERM';
    throw err;
  };
  const session = { aborted: false, child: { pid: 999999 }, lockPromise: acquireLock(cwd) };
  await abortStart(session, { kill: eperm });
  assert.equal(existsSync(runPaths(cwd).lock), false);
});

test('abortStart waits for an in-flight lock and leaves another start\'s lock alone', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  // In flight: the signal arrived before acquireLock resolved.
  const inFlight = { aborted: false, child: null, lockPromise: acquireLock(cwd) };
  await abortStart(inFlight);
  assert.equal(existsSync(runPaths(cwd).lock), false);

  await writeFile(runPaths(cwd).lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  const loser = { aborted: false, child: null, lockPromise: acquireLock(cwd) };
  await abortStart(loser);
  assert.equal(existsSync(runPaths(cwd).lock), true);
});

// A fake daemon that passes the identity check but ignores /shutdown. It runs from a
// file at <dir>/bin/kinet.js with `mcp --port <port>`, so its command line looks like ours.
const STUBBORN_SERVER = `
import http from 'node:http';
const port = Number(process.argv[4]);
const token = process.env.STUB_TOKEN;
http.createServer((req, res) => {
  if (req.headers['x-kinet-token'] !== token) return res.writeHead(401).end();
  if (req.url === '/health') return res.end(JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
  res.writeHead(202).end();
}).listen(port, '127.0.0.1', () => process.stdout.write('ready'));
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
  const stubDir = await tempDir();
  await writeFiles(stubDir, { 'package.json': '{"type":"module"}', 'bin/kinet.js': STUBBORN_SERVER });
  const child = spawn(process.execPath, [join(stubDir, 'bin', 'kinet.js'), 'mcp', '--port', String(port)], {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, STUB_TOKEN: token },
  });
  let ready = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { ready += d; });
  await waitFor(() => ready === 'ready');

  await ensureRunDir(cwd);
  // startedAt is recorded after the process started, as the real daemon does.
  await writeState(cwd, { pid: child.pid, port, token, cwd, startedAt: new Date().toISOString(), logPath: runPaths(cwd).log });
  const output = await captureStdout(() => runMcpStop({ cwd, graceMs: 300, pollMs: 50 }));

  assert.equal(output, `stopped (pid ${child.pid}, force-killed after 0.3 s)\n`);
  await waitFor(() => !isPidAlive(child.pid), 3000);
  assert.equal(await readState(cwd), null);
});
