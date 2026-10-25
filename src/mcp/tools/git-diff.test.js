import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, buildDiffArgs } from './git-diff.js';
import { tempDir, gitRepo, git } from '../../test-support/helpers.js';

const ctxFor = (cwd) => ({ cwd });

async function repo() {
  return gitRepo(await tempDir(), { 'a.js': 'a\n', 'b.js': 'b\n' });
}

test('working scope shows the stat and the patch (AC-2.1, AC-2.2, AC-0.2)', async () => {
  const dir = await repo();
  await writeFile(join(dir, 'a.js'), 'a\nadded-working\n');
  const text = await run({}, ctxFor(dir));
  assert.match(text, /^diff: working tree vs index \(unstaged\)/);
  assert.match(text, /a\.js \| 1 \+/);
  assert.match(text, /\n\+added-working\n/);
});

test('staged scope diffs the index against HEAD', async () => {
  const dir = await repo();
  await writeFile(join(dir, 'b.js'), 'b\nadded-staged\n');
  await git(dir, 'add', 'b.js');
  const text = await run({ scope: 'staged' }, ctxFor(dir));
  assert.match(text, /^diff: index vs HEAD \(staged\)/);
  assert.match(text, /\+added-staged/);
});

test('ref scope diffs ref...HEAD', async () => {
  const dir = await repo();
  await git(dir, 'checkout', '-q', '-b', 'feature');
  await writeFile(join(dir, 'a.js'), 'a\nadded-on-feature\n');
  await git(dir, 'commit', '-q', '-am', 'feature work');
  const text = await run({ scope: 'ref', ref: 'main' }, ctxFor(dir));
  assert.match(text, /^diff: main\.\.\.HEAD/);
  assert.match(text, /\+added-on-feature/);
});

test('path limits the diff to one file (AC-2.3)', async () => {
  const dir = await repo();
  await writeFile(join(dir, 'a.js'), 'a\nchange-a\n');
  await writeFile(join(dir, 'b.js'), 'b\nchange-b\n');
  const text = await run({ path: 'b.js' }, ctxFor(dir));
  assert.match(text, /change-b/);
  assert.equal(text.includes('change-a'), false);
});

test('unknown and injected refs name the ref and run nothing (AC-2.4, AC-0.5)', async () => {
  const dir = await repo();
  assert.equal(await run({ scope: 'ref', ref: 'nope' }, ctxFor(dir)), 'Unknown ref "nope": not a commit in this repository.');
  const text = await run({ scope: 'ref', ref: 'HEAD; touch pwned' }, ctxFor(dir));
  assert.match(text, /^Unknown ref "HEAD; touch pwned"/);
  assert.equal(existsSync(join(dir, 'pwned')), false);
});

test('a clean tree says "No changes" (AC-2.5)', async () => {
  const dir = await repo();
  assert.equal(await run({}, ctxFor(dir)), 'No changes (working tree vs index (unstaged)). Untracked files are not shown; see kinet_git_status.');
});

test('refuses bad arguments (AC-0.8a, AC-0.8c)', async () => {
  const dir = await repo();
  const outFile = join(await tempDir(), 'x');
  await assert.rejects(run({ scope: 'ref', ref: `--output=${outFile}` }, ctxFor(dir)), /values starting with "-"/);
  assert.equal(existsSync(outFile), false);
  await assert.rejects(run({ path: '-x' }, ctxFor(dir)), /values starting with "-"/);
  await assert.rejects(run({ path: '../..' }, ctxFor(dir)), /outside the project directory/);
  await assert.rejects(run({ path: '/etc' }, ctxFor(dir)), /outside the project directory/);
  await assert.rejects(run({ scope: 'ref' }, ctxFor(dir)), /ref is required/);
  await assert.rejects(run({ scope: 'all' }, ctxFor(dir)), /scope must be one of/);
});

test('paths come after the -- separator (AC-0.8b)', () => {
  const args = buildDiffArgs({ scope: 'working', path: 'src' }, { stat: false });
  assert.ok(args.indexOf('--') < args.indexOf('src'));
  assert.ok(args.indexOf('--') >= 0);
});

test('returns a plain message outside a git repo (AC-0.3)', async () => {
  assert.match(await run({}, ctxFor(await tempDir())), /^Not a git repository: .* kinet_git_diff needs a git work tree\.$/);
});
