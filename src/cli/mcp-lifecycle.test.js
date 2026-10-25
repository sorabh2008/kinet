import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { appendFile } from 'node:fs/promises';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { tempDir, freePort, gitRepo, git, runCli, waitFor, BIN_PATH } from '../test-support/helpers.js';
import { ensureRunDir, isPidAlive, readState, runPaths, writeState } from '../mcp/runstate.js';

const skip = process.platform === 'win32';
const projects = new Set();

async function project() {
  const cwd = await gitRepo(await tempDir(), { 'a.js': 'a\n' });
  projects.add(cwd);
  return cwd;
}

// Never leak a daemon, even when an assertion fails half way.
after(async () => {
  for (const cwd of projects) await runCli(['mcp', 'stop'], { cwd });
});

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', (err) => resolve(err.code));
  });
}

function externalIPv4() {
  return Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
}

test('start runs a background server, status reports it, a second start reuses it (AC-7.1-7.4, AC-8.1)', { skip }, async () => {
  const cwd = await project();
  const port = await freePort();
  const started = Date.now();
  const first = await runCli(['mcp', 'start', '--port', String(port)], { cwd });
  assert.equal(first.code, 0, first.stderr);
  assert.ok(Date.now() - started < 5000);
  assert.match(first.stdout, /^KINET MCP server started\n {2}pid: {2}\d+\n/);
  assert.ok(first.stdout.includes(`url:  http://127.0.0.1:${port}/sse`));
  assert.ok(first.stdout.includes(`log:  ${runPaths(cwd).log}`));

  assert.ok(existsSync(runPaths(cwd).state));
  await git(cwd, 'check-ignore', '-q', '.kinet/run/mcp.json');
  const state = await readState(cwd);

  const second = await runCli(['mcp', 'start', '--port', String(port)], { cwd });
  assert.equal(second.code, 0);
  assert.match(second.stdout, /^KINET MCP server already running\n/);
  assert.ok(second.stdout.includes(`pid:  ${state.pid}`));

  const status = await runCli(['mcp', 'status'], { cwd });
  assert.equal(status.code, 0);
  assert.match(status.stdout, /^running\n {2}pid: {4}\d+\n {2}port: {3}\d+\n {2}url: {4}http:\/\/127\.0\.0\.1:\d+\/sse\n {2}uptime: \d+s\n {2}log: {4}/);

  // AC-7.6: reachable on loopback only.
  assert.equal(await canConnect('127.0.0.1', port), true);
  const external = externalIPv4();
  if (external) assert.equal(await canConnect(external, port), 'ECONNREFUSED');
});

test('the parent --port is forwarded to start', { skip }, async () => {
  const cwd = await project();
  const port = await freePort();
  const result = await runCli(['mcp', '--port', String(port), 'start'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readState(cwd)).port, port);
});

test('a busy port fails cleanly and leaves no run state (AC-7.5)', { skip }, async () => {
  const cwd = await project();
  const port = await freePort();
  const blocker = createServer().listen(port, '127.0.0.1');
  try {
    const result = await runCli(['mcp', 'start', '--port', String(port)], { cwd });
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`port ${port} is in use`));
    assert.equal(existsSync(runPaths(cwd).state), false);
    assert.equal(existsSync(runPaths(cwd).lock), false);
  } finally {
    blocker.close();
  }
});

test('status with no state says stopped and creates nothing (AC-8.2, AC-8.4)', { skip }, async () => {
  const cwd = await project();
  const result = await runCli(['mcp', 'status'], { cwd });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'stopped\n');
  assert.equal(existsSync(runPaths(cwd).dir), false);
});

test('status clears state that points at an unrelated live process (AC-8.3)', { skip }, async () => {
  const cwd = await project();
  const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    await ensureRunDir(cwd);
    await writeState(cwd, { pid: unrelated.pid, port: await freePort(), token: 'b'.repeat(64), cwd, startedAt: new Date().toISOString(), logPath: runPaths(cwd).log });
    const result = await runCli(['mcp', 'status'], { cwd });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, 'stopped (stale)\n');
    assert.equal(existsSync(runPaths(cwd).state), false);
    assert.equal(isPidAlive(unrelated.pid), true);
  } finally {
    unrelated.kill('SIGKILL');
  }
});

test('a corrupt state file reads as stopped', { skip }, async () => {
  const cwd = await project();
  await ensureRunDir(cwd);
  await writeFile(runPaths(cwd).state, '{ nope');
  const result = await runCli(['mcp', 'status'], { cwd });
  assert.equal(result.stdout, 'stopped\n');
  assert.equal(await readFile(runPaths(cwd).state, 'utf8'), '{ nope');
});

test('stop shuts the server down gracefully and keeps the log (AC-9.1, AC-8.2, AC-10.5)', { skip }, async () => {
  const cwd = await project();
  const port = await freePort();
  assert.equal((await runCli(['mcp', 'start', '--port', String(port)], { cwd })).code, 0);
  const { pid } = await readState(cwd);

  const stop = await runCli(['mcp', 'stop'], { cwd });
  assert.equal(stop.code, 0);
  assert.equal(stop.stdout, `stopped (pid ${pid})\n`);
  assert.equal(isPidAlive(pid), false);

  const status = await runCli(['mcp', 'status'], { cwd });
  assert.equal(status.code, 1);
  assert.equal(status.stdout, 'stopped\n');
  const log = await readFile(runPaths(cwd).log, 'utf8');
  assert.match(log, /WARN shutdown reason=http/);

  const again = await runCli(['mcp', 'stop'], { cwd });
  assert.equal(again.code, 0);
  assert.equal(again.stdout, 'not running\n');
});

test('stop never signals an unrelated process that reuses the pid (AC-9.2, AC-9.3)', { skip }, async () => {
  const cwd = await project();
  const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    await ensureRunDir(cwd);
    await writeState(cwd, { pid: unrelated.pid, port: await freePort(), token: 'b'.repeat(64), cwd, startedAt: new Date().toISOString(), logPath: runPaths(cwd).log });
    const result = await runCli(['mcp', 'stop'], { cwd });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'not running (cleared stale state)\n');
    assert.equal(existsSync(runPaths(cwd).state), false);
    assert.equal(isPidAlive(unrelated.pid), true);
  } finally {
    unrelated.kill('SIGKILL');
  }
});

test('logs record start, tool calls and shutdown without argument values; start rotates them (AC-10.1, AC-10.3, AC-10.5)', { skip }, async () => {
  const cwd = await project();
  const port = await freePort();
  assert.equal((await runCli(['mcp', 'start', '--port', String(port)], { cwd })).code, 0);
  const { token } = await readState(cwd);

  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`)));
  await client.callTool({ name: 'kinet_git_diff', arguments: { path: 'SECRET_ARG_123' } });
  await client.close();

  const logs = await runCli(['mcp', 'logs', '-n', '5'], { cwd });
  assert.equal(logs.code, 0);
  assert.ok(logs.stdout.split('\n').filter(Boolean).length <= 5);
  assert.match(logs.stdout, /tool name=kinet_git_diff ms=\d+ result=ok/);

  assert.equal((await runCli(['mcp', 'stop'], { cwd })).code, 0);
  const log = await readFile(runPaths(cwd).log, 'utf8');
  assert.match(log, /INFO start mode=daemon port=\d+ pid=\d+ cwd=/);
  assert.match(log, /INFO listening http:\/\/127\.0\.0\.1:\d+\/sse/);
  assert.match(log, /tool name=kinet_git_diff/);
  assert.match(log, /WARN shutdown reason=http/);
  assert.equal(log.includes('SECRET_ARG_123'), false);
  assert.equal(log.includes(token), false);

  assert.equal((await runCli(['mcp', 'start', '--port', String(port)], { cwd })).code, 0);
  assert.equal(await readFile(runPaths(cwd).prevLog, 'utf8'), log);
  assert.equal((await runCli(['mcp', 'stop'], { cwd })).code, 0);
});

test('logs -f streams new lines until Ctrl-C (AC-10.2)', { skip }, async () => {
  const cwd = await project();
  await ensureRunDir(cwd);
  await writeFile(runPaths(cwd).log, 'first line\n');
  const child = spawn(process.execPath, [BIN_PATH, 'mcp', 'logs', '-f'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
  await waitFor(() => stdout.includes('first line'));
  await appendFile(runPaths(cwd).log, 'appended line\n');
  await waitFor(() => stdout.includes('appended line'), 5000);
  child.kill('SIGINT');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});

test('logs without a log file explains what to do (AC-10.4)', { skip }, async () => {
  const cwd = await project();
  const result = await runCli(['mcp', 'logs'], { cwd });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no logs — has `kinet mcp start` been run\?/);
});

test('start refuses a symlinked .kinet planted by a cloned repo (06-security finding 1)', { skip }, async () => {
  const cwd = await project();
  const elsewhere = await tempDir();
  await symlink(elsewhere, join(cwd, '.kinet'));
  const result = await runCli(['mcp', 'start', '--port', String(await freePort())], { cwd });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /is a symlink/);
  assert.equal(existsSync(join(elsewhere, 'run')), false);
});

test('a copied project never sees or stops the original project\'s server (06-test-plan F-5)', { skip }, async () => {
  const projA = await project();
  const portA = await freePort();
  assert.equal((await runCli(['mcp', 'start', '--port', String(portA)], { cwd: projA })).code, 0);
  const { pid: pidA } = await readState(projA);

  const projB = join(await tempDir(), 'projB');
  await cp(projA, projB, { recursive: true });
  projects.add(projB);

  const status = await runCli(['mcp', 'status'], { cwd: projB });
  assert.equal(status.code, 1);
  assert.equal(status.stdout, 'stopped (stale)\n');

  const stop = await runCli(['mcp', 'stop'], { cwd: projB });
  assert.equal(stop.code, 0);
  assert.match(stop.stdout, /^not running/);
  assert.equal(isPidAlive(pidA), true);

  const startB = await runCli(['mcp', 'start', '--port', String(await freePort())], { cwd: projB });
  assert.equal(startB.code, 0, startB.stderr);
  assert.match(startB.stdout, /^KINET MCP server started/);
  assert.notEqual((await readState(projB)).pid, pidA);
  assert.equal((await runCli(['mcp', 'status'], { cwd: projA })).code, 0);
});
