import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertNoLeadingDash, resolveInsideProject, parsePort, parsePositiveInt } from './args.js';
import { tempDir } from '../test-support/helpers.js';

test('assertNoLeadingDash refuses option-like values (AC-0.8a)', () => {
  assert.throws(() => assertNoLeadingDash('--output=/tmp/x', 'ref'), /Refusing ref "--output=\/tmp\/x"/);
  assert.throws(() => assertNoLeadingDash('-x', 'path'), /values starting with "-"/);
  assert.doesNotThrow(() => assertNoLeadingDash('main', 'ref'));
});

test('resolveInsideProject keeps paths inside the project (AC-0.8c)', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, '..config'));
  await symlink('/etc', join(dir, 'etc-link'));

  assert.equal(await resolveInsideProject(dir, 'src'), 'src');
  assert.equal(await resolveInsideProject(dir, '.'), '.');
  assert.equal(await resolveInsideProject(dir, '..config'), '..config');
  await assert.rejects(resolveInsideProject(dir, '../..'), /outside the project directory/);
  await assert.rejects(resolveInsideProject(dir, '/etc'), /outside the project directory/);
  await assert.rejects(resolveInsideProject(dir, 'etc-link'), /outside the project directory/);
  await assert.rejects(resolveInsideProject(dir, '-x'), /values starting with "-"/);
});

test('resolveInsideProject returns the lexical path for files that do not exist', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'kept.js'), '');
  assert.equal(await resolveInsideProject(dir, 'src/deleted.js'), join('src', 'deleted.js'));
  assert.equal(await resolveInsideProject(dir, 'gone/also-gone.js'), join('gone', 'also-gone.js'));
});

test('parsePort accepts integers 1-65535 only', () => {
  assert.equal(parsePort('7345'), 7345);
  for (const bad of ['80abc', '0', '65536', '-1', '1.5', '']) {
    assert.throws(() => parsePort(bad), /must be an integer 1-65535/, bad);
  }
});

test('parsePositiveInt accepts integers >= 1 only', () => {
  assert.equal(parsePositiveInt('50'), 50);
  for (const bad of ['0', 'x', '-3', '2.5']) assert.throws(() => parsePositiveInt(bad), bad);
});
