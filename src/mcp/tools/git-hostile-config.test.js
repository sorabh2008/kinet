import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as gitStatus from './git-status.js';
import * as gitDiff from './git-diff.js';
import * as findMarkers from './find-todos.js';
import { tempDir, gitRepo, git } from '../../test-support/helpers.js';

// A project unpacked from an archive can ship .git/config with commands that git
// would run on our behalf (review-6b finding 1). None of the git tools may run them.
test('repo-configured fsmonitor, textconv and diff.external commands are never run', { skip: process.platform === 'win32' }, async () => {
  const dir = await gitRepo(await tempDir(), { 'a.txt': 'a\n', '.gitattributes': '*.txt diff=evil\n' });
  const outside = await tempDir();
  const fsmonitorMarker = join(outside, 'fsmonitor-ran');
  const textconvMarker = join(outside, 'textconv-ran');
  const externalMarker = join(outside, 'external-diff-ran');
  const externalHook = join(outside, 'external.sh');
  const fsmonitorHook = join(outside, 'fsmonitor.sh');
  const textconvHook = join(outside, 'textconv.sh');
  await writeFile(fsmonitorHook, `#!/bin/sh\ntouch "${fsmonitorMarker}"\n`);
  await writeFile(textconvHook, `#!/bin/sh\ntouch "${textconvMarker}"\ncat "$1"\n`);
  await chmod(fsmonitorHook, 0o755);
  await chmod(textconvHook, 0o755);
  await writeFile(externalHook, `#!/bin/sh\ntouch "${externalMarker}"\n`);
  await chmod(externalHook, 0o755);
  await git(dir, 'config', 'diff.external', externalHook);
  await git(dir, 'config', 'core.fsmonitor', fsmonitorHook);
  await git(dir, 'config', 'diff.evil.textconv', textconvHook);
  await writeFile(join(dir, 'a.txt'), 'a\nchanged\n');

  const ctx = { cwd: dir };
  await gitStatus.run({}, ctx);
  const diff = await gitDiff.run({}, ctx);
  await findMarkers.run({}, ctx);

  assert.match(diff, /\+changed/);
  assert.equal(existsSync(fsmonitorMarker), false, 'core.fsmonitor ran');
  assert.equal(existsSync(textconvMarker), false, 'textconv ran');
  assert.equal(existsSync(externalMarker), false, 'diff.external ran');
});
