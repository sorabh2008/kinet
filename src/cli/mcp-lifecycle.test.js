import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { tempDir, freePort, gitRepo, git, runCli } from '../test-support/helpers.js';
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
