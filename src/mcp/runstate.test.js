import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile, utimes, writeFile } from 'node:fs/promises';
import {
  acquireLock, ensureRunDir, runPaths, readState, writeState, clearState, checkIdentity, isPidAlive, LockHeldError,
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
