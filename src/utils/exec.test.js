import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeExec, capText, killActiveProcessGroups } from './exec.js';
import { tempDir, waitFor } from '../test-support/helpers.js';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

test('capText keeps the head and says how many lines were dropped', () => {
  assert.equal(capText('short', 100), 'short');
  assert.equal(capText('a\nb\nc\nd\n', 4), 'a\nb\n\n[truncated: 2 more lines]');
  assert.equal(capText('a\nb\nc\nd', 4), 'a\nb\n\n[truncated: 2 more lines]');
});

test('capText keeps the tail and says how many earlier lines were dropped', () => {
  assert.equal(capText('a\nb\nc\nd\n', 4, 'tail'), '[truncated: 2 earlier lines]\nc\nd\n');
});

test('safeExec caps long output and marks it truncated (AC-0.4)', async () => {
  const script = 'for (let i = 0; i < 1000; i++) console.log("line " + i)';
  const head = await safeExec(process.execPath, ['-e', script], { maxChars: 100 });
  assert.equal(head.code, 0);
  assert.equal(head.truncated, true);
  assert.match(head.stdout, /^line 0\n/);
  assert.match(head.stdout, /\[truncated: \d+ more lines\]$/);

  const tail = await safeExec(process.execPath, ['-e', script], { maxChars: 100, keep: 'tail' });
  assert.match(tail.stdout, /^\[truncated: \d+ earlier lines\]\n/);
  assert.match(tail.stdout, /line 999\n$/);
});

test('safeExec passes arguments literally, never through a shell (AC-0.5)', async () => {
  const dir = await tempDir();
  const payload = '$(touch pwned); echo x';
  const result = await safeExec(process.execPath, ['-e', 'console.log(process.argv[1])', payload], { cwd: dir });
  assert.equal(result.stdout.trim(), payload);
  assert.equal(existsSync(join(dir, 'pwned')), false);
});

test('safeExec resolves on a non-zero exit and rejects when the command is missing', async () => {
  const result = await safeExec(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(result.code, 3);
  await assert.rejects(safeExec('kinet-no-such-binary', []), /kinet-no-such-binary not found on PATH/);
});

test('safeExec kills the process group on timeout', async () => {
  const result = await safeExec(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, null);
});

test('safeExec strips KINET_MCP_TOKEN from the child env', async () => {
  const env = { ...process.env, KINET_MCP_TOKEN: 'a'.repeat(64) };
  const result = await safeExec(process.execPath, ['-e', 'console.log(String(process.env.KINET_MCP_TOKEN))'], { env });
  assert.equal(result.stdout.trim(), 'undefined');
});

test('killActiveProcessGroups kills grandchildren too', { skip: process.platform === 'win32' }, async () => {
  const dir = await tempDir();
  const pidFile = join(dir, 'pid');
  const pending = safeExec('sh', ['-c', `sleep 30 & echo $! > "${pidFile}"; wait`], { cwd: dir });
  const grandchild = await waitFor(async () => {
    const text = existsSync(pidFile) ? (await readFile(pidFile, 'utf8')).trim() : '';
    return text ? Number(text) : 0;
  });
  assert.equal(isAlive(grandchild), true);
  assert.equal(killActiveProcessGroups(), 1);
  await pending;
  await waitFor(() => !isAlive(grandchild), 3000);
});
