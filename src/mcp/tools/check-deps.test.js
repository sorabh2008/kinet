import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, parseOutdated, parseAudit } from './check-deps.js';
import { tempDir, writeFiles } from '../../test-support/helpers.js';

const skip = process.platform === 'win32';
const ctxFor = (cwd) => ({ cwd });

// Each test file runs in its own process, so pointing npm at a dead registry here is safe.
Object.assign(process.env, {
  npm_config_registry: 'http://127.0.0.1:9',
  npm_config_fetch_retries: '0',
  npm_config_fetch_timeout: '2000',
  npm_config_audit_level: 'info',
});

const PKG = { name: 'f', version: '1.0.0', dependencies: { 'left-pad': '1.0.0' }, devDependencies: { eslint: '^9.0.0' } };

test('parseOutdated reports name, versions and dependency type (AC-5.1)', () => {
  const stdout = JSON.stringify({
    'left-pad': { current: '1.0.0', wanted: '1.0.0', latest: '1.3.0', dependent: 'f', location: 'x' },
    eslint: { current: '9.0.0', wanted: '9.39.5', latest: '10.0.1' },
    'some-transitive': { wanted: '2.0.0', latest: '2.0.0' },
    shared: [{ current: '1.0.0', wanted: '1.1.0', latest: '2.0.0' }, { current: '1.0.1', wanted: '1.1.0', latest: '2.0.0' }],
  });
  const result = parseOutdated(stdout, PKG);
  assert.equal(result.count, 5);
  assert.deepEqual(result.packages[0], { name: 'left-pad', current: '1.0.0', wanted: '1.0.0', latest: '1.3.0', type: 'prod' });
  assert.equal(result.packages[1].type, 'dev');
  assert.equal(result.packages[2].current, 'missing');
  assert.equal(result.packages[2].type, 'transitive');
  assert.equal(parseOutdated('{}', PKG).count, 0);
});

test('parseAudit summarises severities and affected packages (AC-5.2)', () => {
  const stdout = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      a: { name: 'a', severity: 'high', isDirect: true, fixAvailable: true },
      b: { name: 'b', severity: 'moderate', isDirect: false, fixAvailable: { name: 'x', version: '2.0.0' } },
      c: { name: 'c', severity: 'low', isDirect: false, fixAvailable: false },
    },
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 1, high: 1, critical: 0, total: 3 } },
  });
  const result = parseAudit(stdout);
  assert.deepEqual(result.counts, { critical: 0, high: 1, moderate: 1, low: 1, info: 0, total: 3 });
  assert.deepEqual(result.packages[0], { name: 'a', severity: 'high', direct: true, fixAvailable: true });
  assert.equal(result.packages[1].fixAvailable, true);
  assert.equal(result.packages[2].fixAvailable, false);
});

test('parsers throw on npm error JSON, empty output and bad JSON', () => {
  assert.throws(() => parseAudit(JSON.stringify({ error: { code: 'ENOLOCK', summary: 'needs a lockfile' } })), (err) => err.code === 'ENOLOCK');
  assert.throws(() => parseAudit(JSON.stringify({ message: 'connect ECONNREFUSED 127.0.0.1:9', error: { summary: '' } })), (err) => err.code === 'ECONNREFUSED');
  assert.throws(() => parseOutdated('', PKG), /no output/);
  assert.throws(() => parseOutdated('not json', PKG), /not valid JSON/);
});

test('an unreachable registry and a missing lockfile are reported per section (AC-5.3, AC-5.5)', { skip }, async () => {
  const dir = await tempDir();
  await writeFiles(dir, { 'package.json': JSON.stringify(PKG) });
  const result = await run({}, ctxFor(dir));
  assert.deepEqual(Object.keys(result), ['outdated', 'audit']);
  assert.equal(result.outdated.error, 'could not check: registry unreachable (ECONNREFUSED)');
  assert.equal(result.audit.error, 'could not check: no lockfile (run npm install to create one)');
});

test('is read-only and returns only the requested section (AC-5.3, AC-5.4)', { skip }, async () => {
  const dir = await tempDir();
  const lock = {
    name: 'f', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'f', version: '1.0.0', dependencies: { 'left-pad': '1.0.0' } }, 'node_modules/left-pad': { version: '1.0.0' } },
  };
  await writeFiles(dir, { 'package.json': JSON.stringify(PKG), 'package-lock.json': JSON.stringify(lock) });
  const before = [await readFile(join(dir, 'package.json')), await readFile(join(dir, 'package-lock.json'))];

  const result = await run({ check: 'audit' }, ctxFor(dir));
  assert.deepEqual(Object.keys(result), ['audit']);
  assert.match(result.audit.error, /^could not check: registry unreachable/);
  await run({ check: 'outdated' }, ctxFor(dir));

  const after = [await readFile(join(dir, 'package.json')), await readFile(join(dir, 'package-lock.json'))];
  assert.deepEqual(after, before);
});

test('plain message without package.json, and a bad check is refused (AC-0.3)', { skip }, async () => {
  const dir = await tempDir();
  assert.match(await run({}, ctxFor(dir)), /^No package\.json in .*; kinet_check_deps needs an npm project\.$/);
  await assert.rejects(run({ check: 'everything' }, ctxFor(dir)), /check must be one of: outdated, audit, all/);
});
