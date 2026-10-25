import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as tool from './find-todos.js';
import { tempDir, gitRepo, writeFiles, MARKER } from '../../test-support/helpers.js';

const ctxFor = (cwd) => ({ cwd });

const FIXTURE = {
  'src/app.js': [
    'const a = 1;',
    `// ${MARKER} [PROJ-123] tidy this`,
    `// ${MARKER} fix this`,
    `// my${MARKER}s is not a marker`,
    '// FIXME: broken',
    '// HACK [ABC-9] works around a bug',
  ].join('\n'),
  'src/deep/x.js': `// XXX check\n`,
  'node_modules/dep/index.js': `// ${MARKER} in a dependency\n`,
  'src/node_modules/nested/index.js': `// ${MARKER} nested dependency\n`,
  'ignored/skip.js': `// ${MARKER} ignored\n`,
  '.gitignore': 'ignored/\n',
};

async function writeFixture(dir) {
  await writeFiles(dir, FIXTURE);
  await writeFiles(dir, { 'bin.dat': Buffer.from(`${MARKER} binary\0\0data`) });
  return dir;
}

function summary(output) {
  return output.results.map((r) => `${r.file}:${r.line}:${r.marker}:${r.hasTicket}`);
}

const EXPECTED = [
  `${join('src', 'app.js')}:2:${MARKER}:true`,
  `${join('src', 'app.js')}:3:${MARKER}:false`,
  `${join('src', 'app.js')}:5:FIXME:false`,
  `${join('src', 'app.js')}:6:HACK:true`,
  `${join('src', 'deep', 'x.js')}:1:XXX:false`,
];

test('git repo: finds real markers only and skips node_modules, ignored and binary files (AC-3.1, AC-3.3)', async () => {
  const dir = await gitRepo(await tempDir());
  await writeFixture(dir);
  const output = await tool.run({}, ctxFor(dir));
  assert.deepEqual(summary(output), EXPECTED);
  assert.equal(output.total, 5);
  assert.equal(output.missingTicket, 3);
  assert.equal(output.results[1].text, `// ${MARKER} fix this`);
});

test('missingTicketOnly filters results but keeps the counts (AC-3.4)', async () => {
  const dir = await gitRepo(await tempDir());
  await writeFixture(dir);
  const output = await tool.run({ missingTicketOnly: true, path: 'src' }, ctxFor(dir));
  assert.equal(output.total, 5);
  assert.equal(output.missingTicket, 3);
  assert.equal(output.results.every((r) => !r.hasTicket), true);
  assert.equal(output.results.length, 3);
});

test('non-git directory gives the same results, ignoring node_modules and binaries', async () => {
  const dir = await writeFixture(await tempDir());
  const output = await tool.run({}, ctxFor(dir));
  // Without git there is no .gitignore handling, so the ignored dir is scanned.
  const expected = [`${join('ignored', 'skip.js')}:1:${MARKER}:false`, ...EXPECTED];
  assert.deepEqual(summary(output), expected);
});

test('path is confined to the project and must exist (AC-0.8c)', async () => {
  const dir = await gitRepo(await tempDir());
  await writeFixture(dir);
  await assert.rejects(tool.run({ path: '../..' }, ctxFor(dir)), /outside the project directory/);
  await assert.rejects(tool.run({ path: '-n' }, ctxFor(dir)), /values starting with "-"/);
  assert.equal(await tool.run({ path: 'missing' }, ctxFor(dir)), 'Path not found: missing');
});

test('the scan path comes after the -- separator (AC-0.8b)', () => {
  const args = tool.buildGrepArgs('src');
  assert.ok(args.indexOf('--') >= 0 && args.indexOf('--') < args.indexOf('src'));
});
