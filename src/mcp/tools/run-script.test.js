import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, definition } from './run-script.js';
import { tempDir, writeFiles, waitFor } from '../../test-support/helpers.js';

const skip = process.platform === 'win32';
const ctxFor = (cwd) => ({ cwd });

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function fixture() {
  const dir = await tempDir();
  const scripts = {
    ok: `node -e "console.log('hi')"`,
    fail: 'node -e "process.exit(3)"',
    slow: `node -e "require('fs').writeFileSync('slow.pid', String(process.pid)); setTimeout(() => {}, 60000)"`,
    loud: `node -e "for (let i = 0; i < 50000; i++) console.log('line ' + i)"`,
    touch: `node -e "require('fs').writeFileSync('ran', '')"`,
    token: 'node -e "console.log(String(process.env.KINET_MCP_TOKEN))"',
  };
  await writeFiles(dir, { 'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }) });
  return dir;
}

test('the description warns that it executes project code (AC-4.6)', () => {
  assert.match(definition.description, /executes project code/);
});

test('no script lists the scripts and runs nothing (AC-4.1, AC-0.2)', { skip }, async () => {
  const dir = await fixture();
  const text = await run({}, ctxFor(dir));
  assert.match(text, /^scripts in package\.json \(6\):\n {2}ok {5}node -e/);
  assert.equal(existsSync(join(dir, 'ran')), false);
});

test('only declared scripts can run (AC-4.2)', { skip }, async () => {
  const dir = await fixture();
  await assert.rejects(run({ script: 'x; rm -rf ~' }, ctxFor(dir)), /Unknown script "x; rm -rf ~"\. Valid scripts: ok, fail, slow, loud, touch, token/);
  await assert.rejects(run({ script: '__proto__' }, ctxFor(dir)), /Unknown script "__proto__"/);
  await assert.rejects(run({ script: '--version' }, ctxFor(dir)), /values starting with "-"/);
});

test('a passing and a failing script are both normal results (AC-4.3, AC-4.5)', { skip }, async () => {
  const dir = await fixture();
  const ok = await run({ script: 'ok' }, ctxFor(dir));
  assert.match(ok, /^script: ok\ncommand: node -e .*\nexit code: 0\nduration: \d+\.\d s\n--- output ---\n/);
  assert.match(ok, /\nhi\n/);
  const fail = await run({ script: 'fail' }, ctxFor(dir));
  assert.match(fail, /\nexit code: 3\n/);
});

test('a timeout kills the whole process group (AC-4.4)', { skip }, async () => {
  const dir = await fixture();
  const text = await run({ script: 'slow', timeoutSeconds: 1 }, ctxFor(dir));
  assert.match(text, /\nresult: timed out after 1 s; process group killed\n/);
  const pid = Number(await readFile(join(dir, 'slow.pid'), 'utf8'));
  await waitFor(() => !isAlive(pid), 3000);
});

test('long output keeps the tail (AC-4.3, AC-0.4)', { skip }, async () => {
  const dir = await fixture();
  const text = await run({ script: 'loud' }, ctxFor(dir));
  assert.match(text, /--- output ---\n\[truncated: \d+ earlier lines\]\n/);
  assert.match(text, /line 49999\n$/);
  assert.ok(text.length < 20000);
});

test('scripts never see the daemon token', { skip }, async () => {
  const dir = await fixture();
  process.env.KINET_MCP_TOKEN = 'f'.repeat(64);
  try {
    assert.match(await run({ script: 'token' }, ctxFor(dir)), /\nundefined\n/);
  } finally {
    delete process.env.KINET_MCP_TOKEN;
  }
});

test('plain messages without a usable package.json (AC-0.3)', { skip }, async () => {
  const dir = await tempDir();
  assert.match(await run({}, ctxFor(dir)), /^No package\.json in .*; kinet_run_script needs an npm project\.$/);
  await writeFiles(dir, { 'package.json': '{ nope' });
  assert.match(await run({}, ctxFor(dir)), /^package\.json could not be parsed: /);
  await writeFiles(dir, { 'package.json': '{}' });
  assert.equal(await run({}, ctxFor(dir)), 'package.json defines no scripts.');
});
