import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { formatUptime, lastLines, abortStart } from './mcp.js';
import { acquireLock, ensureRunDir, runPaths, isPidAlive } from '../mcp/runstate.js';
import { tempDir, waitFor } from '../test-support/helpers.js';

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
