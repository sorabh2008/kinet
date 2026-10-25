import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acquireLock, ensureRunDir, runPaths, readState, writeState, clearState, checkIdentity, isPidAlive, LockHeldError,
  UnsafeRunDirError, LOG_OPEN_FLAGS, parseElapsed, looksLikeOurDaemon,
} from './runstate.js';
import { tempDir, freePort } from '../test-support/helpers.js';

async function deadPid() {
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  return child.pid;
}

async function writeLock(cwd, lock) {
  await ensureRunDir(cwd);
  await writeFile(runPaths(cwd).lock, JSON.stringify(lock));
}

test('ensureRunDir creates a self-ignoring run dir', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  assert.equal(await readFile(runPaths(cwd).gitignore, 'utf8'), '*\n');
});

test('state round-trips through an atomic write and can be cleared', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  assert.equal(await readState(cwd), null);
  await writeState(cwd, { pid: 1, port: 2 });
  assert.deepEqual(await readState(cwd), { pid: 1, port: 2 });
  assert.equal(existsSync(runPaths(cwd).tmp), false);
  await clearState(cwd);
  await clearState(cwd);
  assert.equal(await readState(cwd), null);
});

test('acquireLock creates the lock, refuses a live fresh lock and releases', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  const release = await acquireLock(cwd);
  await assert.rejects(acquireLock(cwd), (err) => err instanceof LockHeldError && err.pid === process.pid);
  await release();
  assert.equal(existsSync(runPaths(cwd).lock), false);
});

test('a lock held by a dead pid is stale (review-2 finding 2)', async () => {
  const cwd = await tempDir();
  await writeLock(cwd, { pid: await deadPid(), createdAt: new Date().toISOString() });
  const release = await acquireLock(cwd);
  await release();
});

test('a lock older than 10 s is stale even if its pid is alive', async () => {
  const cwd = await tempDir();
  await writeLock(cwd, { pid: process.pid, createdAt: new Date(Date.now() - 11000).toISOString() });
  const release = await acquireLock(cwd);
  await release();
});

test('an unparseable lock is judged by its age', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  await writeFile(runPaths(cwd).lock, 'garbage');
  await assert.rejects(acquireLock(cwd), LockHeldError);
  const old = new Date(Date.now() - 60000);
  await utimes(runPaths(cwd).lock, old, old);
  const release = await acquireLock(cwd);
  await release();
});

test('isPidAlive', async () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(await deadPid()), false);
});

test('checkIdentity: no state is stopped; dead pid or wrong server is stale; nothing is deleted', async () => {
  const cwd = await tempDir();
  await ensureRunDir(cwd);
  assert.deepEqual(await checkIdentity(cwd), { state: 'stopped' });

  await writeState(cwd, { pid: await deadPid(), port: await freePort(), token: 'a'.repeat(64), cwd, startedAt: new Date().toISOString() });
  assert.equal((await checkIdentity(cwd)).state, 'stale');

  // A live but unrelated pid with nothing listening on the port.
  await writeState(cwd, { pid: process.pid, port: await freePort(), token: 'a'.repeat(64), cwd, startedAt: new Date().toISOString() });
  const identity = await checkIdentity(cwd);
  assert.equal(identity.state, 'stale');
  assert.match(identity.reason, /health check failed/);
  assert.notEqual(await readState(cwd), null);
});

const posixOnly = { skip: process.platform === 'win32' };

test('writeState does not follow a symlink planted at the temp path (06-security finding 1)', posixOnly, async () => {
  const cwd = await tempDir();
  const victim = join(await tempDir(), 'victim.txt');
  await writeFile(victim, 'keep me\n');
  await ensureRunDir(cwd);
  await symlink(victim, runPaths(cwd).tmp);

  const state = { pid: 1, port: 7345, label: 'fixture-state' };
  await writeState(cwd, state);

  assert.equal(await readFile(victim, 'utf8'), 'keep me\n');
  assert.equal((await lstat(runPaths(cwd).state)).isSymbolicLink(), false);
  assert.equal((await stat(runPaths(cwd).state)).mode & 0o777, 0o600);
  assert.deepEqual(await readState(cwd), state);
});

test('ensureRunDir refuses a symlinked .kinet or .kinet/run and creates the dir 0700', posixOnly, async () => {
  const elsewhere = await tempDir();

  const linkedKinet = await tempDir();
  await symlink(elsewhere, join(linkedKinet, '.kinet'));
  await assert.rejects(ensureRunDir(linkedKinet), UnsafeRunDirError);

  const linkedRun = await tempDir();
  await mkdir(join(linkedRun, '.kinet'));
  await symlink(elsewhere, join(linkedRun, '.kinet', 'run'));
  await assert.rejects(ensureRunDir(linkedRun), UnsafeRunDirError);
  assert.equal(existsSync(join(elsewhere, '.gitignore')), false);

  const fresh = await tempDir();
  await ensureRunDir(fresh);
  assert.equal((await stat(runPaths(fresh).dir)).mode & 0o777, 0o700);
});

test('the log open flags refuse a symlinked log file', posixOnly, async () => {
  const cwd = await tempDir();
  const victim = join(await tempDir(), 'victim.log');
  await writeFile(victim, 'keep\n');
  await ensureRunDir(cwd);
  await symlink(victim, runPaths(cwd).log);
  await assert.rejects(open(runPaths(cwd).log, LOG_OPEN_FLAGS, 0o600), (err) => err.code === 'ELOOP');
  assert.equal(await readFile(victim, 'utf8'), 'keep\n');
});

test('parseElapsed reads ps etime', () => {
  assert.equal(parseElapsed('00:05'), 5);
  assert.equal(parseElapsed(' 01:02:03'), 3723);
  assert.equal(parseElapsed('2-00:00:01'), 172801);
  assert.equal(parseElapsed('soon'), null);
});

test('looksLikeOurDaemon needs our command line and a start before startedAt', posixOnly, async () => {
  const notOurs = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const dir = await tempDir();
  await mkdir(join(dir, 'bin'));
  await writeFile(join(dir, 'bin', 'kinet.js'), 'setTimeout(() => {}, 30000);');
  const port = 7399;
  const lookalike = spawn(process.execPath, [join(dir, 'bin', 'kinet.js'), 'mcp', '--port', String(port)], { stdio: 'ignore' });
  try {
    const now = new Date().toISOString();
    assert.equal(await looksLikeOurDaemon({ pid: notOurs.pid, port, startedAt: now }), false);
    assert.equal(await looksLikeOurDaemon({ pid: lookalike.pid, port, startedAt: now }), true);
    assert.equal(await looksLikeOurDaemon({ pid: lookalike.pid, port: port + 1, startedAt: now }), false);
    // Started an hour after the state says the server started: a reused pid.
    const longAgo = new Date(Date.now() - 3600_000).toISOString();
    assert.equal(await looksLikeOurDaemon({ pid: lookalike.pid, port, startedAt: longAgo }), false);
  } finally {
    notOurs.kill('SIGKILL');
    lookalike.kill('SIGKILL');
  }
});
