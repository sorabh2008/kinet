import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, parsePorcelainV2 } from './git-status.js';
import { clampInt } from './git-common.js';
import { tempDir, gitRepo, git } from '../../test-support/helpers.js';

const ctxFor = (cwd) => ({ cwd });

async function repoWithChanges() {
  const dir = await gitRepo(await tempDir(), { 'a.js': 'a\n', 'README.md': 'r\n' });
  await writeFile(join(dir, 'a.js'), 'a2\n');
  await git(dir, 'add', 'a.js');
  await writeFile(join(dir, 'README.md'), 'r2\n');
  await writeFile(join(dir, 'new.txt'), 'n\n');
  return dir;
}

test('lists staged, unstaged and untracked files (AC-1.1) without a .kinet dir (AC-0.2)', async () => {
  const dir = await repoWithChanges();
  const text = await run({}, ctxFor(dir));
  assert.match(text, /^branch: main \(no upstream\)/);
  assert.match(text, /staged \(1\):\n {2}M a\.js/);
  assert.match(text, /unstaged \(1\):\n {2}M README\.md/);
  assert.match(text, /untracked \(1\):\n {2}new\.txt/);
  assert.match(text, /conflicted: none/);
  assert.match(text, /recent commits \(1\):\n {2}[0-9a-f]{7,} {2}\S+ {2}Test {2}initial/);
});

test('reports upstream ahead/behind counts (AC-1.1)', async () => {
  const remote = await tempDir();
  await git(remote, 'init', '-q', '--bare');
  const dir = await gitRepo(await tempDir(), { 'a.js': 'a\n' });
  await git(dir, 'remote', 'add', 'origin', remote);
  await git(dir, 'push', '-q', '-u', 'origin', 'main');
  await git(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
  const text = await run({ commits: 2 }, ctxFor(dir));
  assert.match(text, /^branch: main \(upstream origin\/main, ahead 1, behind 0\)/);
  assert.match(text, /recent commits \(2\):/);
});

test('clamps the commit count to 1..50 (AC-1.2)', async () => {
  assert.equal(clampInt(999, { min: 1, max: 50, fallback: 10 }), 50);
  assert.equal(clampInt(0, { min: 1, max: 50, fallback: 10 }), 1);
  assert.equal(clampInt('x', { min: 1, max: 50, fallback: 10 }), 10);
  const dir = await gitRepo(await tempDir(), { 'a.js': 'a\n' });
  assert.match(await run({ commits: 999 }, ctxFor(dir)), /recent commits \(1\):/);
});

test('reports a detached HEAD and an empty repo as states, not errors (AC-1.3)', async () => {
  const dir = await gitRepo(await tempDir(), { 'a.js': 'a\n' });
  await git(dir, 'checkout', '-q', '--detach');
  assert.match(await run({}, ctxFor(dir)), /^branch: \(detached HEAD at [0-9a-f]{7}\)/);

  const empty = await gitRepo(await tempDir());
  const text = await run({}, ctxFor(empty));
  assert.match(text, /^branch: main \(no commits yet\)/);
  assert.match(text, /recent commits: none \(no commits yet\)/);
});

test('is read-only (AC-1.4)', async () => {
  const dir = await repoWithChanges();
  const before = [await git(dir, 'status', '--porcelain'), await git(dir, 'rev-parse', 'HEAD')];
  await run({}, ctxFor(dir));
  const after = [await git(dir, 'status', '--porcelain'), await git(dir, 'rev-parse', 'HEAD')];
  assert.deepEqual(after, before);
  assert.equal(existsSync(join(dir, '.git', 'index.lock')), false);
});

test('returns a plain message outside a git repo (AC-0.3)', async () => {
  const dir = await tempDir();
  assert.match(await run({}, ctxFor(dir)), /^Not a git repository: .* kinet_git_status needs a git work tree\.$/);
});

test('parses renames from porcelain v2', () => {
  const status = parsePorcelainV2('# branch.oid abc\n# branch.head main\n2 R. N... 100644 100644 100644 h1 h2 R100 new name.js\told.js\n');
  assert.deepEqual(status.staged, ['R new name.js <- old.js']);
});
