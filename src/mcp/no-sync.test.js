import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from '../test-support/helpers.js';
import { localTools } from './tools/local.js';

const SRC = join(REPO_ROOT, 'src');
const BLOCKING_CALLS = /\b(execSync|spawnSync|execFileSync|readFileSync|writeFileSync)\b/;

async function newToolFiles() {
  const files = await readdir(join(SRC, 'mcp', 'tools'));
  const existing = ['web-search.js', 'github-search.js'];
  return files.filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !existing.includes(f)).map((f) => join('mcp', 'tools', f));
}

test('new code uses no synchronous blocking calls (AC-0.9)', async () => {
  const files = [
    ...(await newToolFiles()),
    join('utils', 'exec.js'), join('utils', 'args.js'),
    join('mcp', 'http.js'), join('mcp', 'log.js'), join('mcp', 'runstate.js'),
  ];
  assert.equal(localTools.length, 5);
  for (const file of files) {
    let source;
    try {
      source = await readFile(join(SRC, file), 'utf8');
    } catch (err) {
      // http.js and runstate.js land in later slices.
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    assert.equal(BLOCKING_CALLS.test(source), false, `${file} uses a *Sync call`);
  }
});
