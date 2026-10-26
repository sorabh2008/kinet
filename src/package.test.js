import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './test-support/helpers.js';

const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));

test('no new production dependency (AC-0.6)', () => {
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@anthropic-ai/sdk', '@modelcontextprotocol/sdk', 'chalk', 'commander', 'glob', 'inquirer', 'js-yaml', 'ora', 'zod',
  ]);
});

test('tests and test helpers are excluded from the npm tarball', () => {
  assert.ok(pkg.files.includes('!src/**/*.test.js'));
  assert.ok(pkg.files.includes('!src/test-support'));
});

test('test script lets node find the test files itself', () => {
  assert.equal(pkg.scripts.test, 'node --test');
});
