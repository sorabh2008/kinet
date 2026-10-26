import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, existsSync, lstatSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installTeam, listTeam, teamContextImports, teamDir } from './installer.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kinet-team-')));
  const dir = join(root, 'brain', '_shared');
  for (const sub of ['agents', 'commands', 'skills/retro', 'skills/not-a-skill', 'knowledge']) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  writeFileSync(join(dir, 'agents', 'developer.md'), 'DEV');
  writeFileSync(join(dir, 'agents', 'tester.md'), 'TEST');
  writeFileSync(join(dir, 'commands', 'deliver.md'), 'DELIVER');
  writeFileSync(join(dir, 'skills', 'retro', 'SKILL.md'), 'RETRO');
  writeFileSync(join(dir, 'knowledge', 'ways-of-working.md'), 'WOW');
  writeFileSync(join(dir, 'team-lead.md'), 'LEAD');
  const cwd = join(root, 'project');
  mkdirSync(cwd);
  return { root, dir, cwd };
}

test('returns null and touches nothing when there is no team dir', () => {
  const { root, cwd } = fixture();
  assert.equal(installTeam(cwd, join(root, 'missing')), null);
  assert.equal(existsSync(join(cwd, '.claude')), false);
});

test('links agents, commands and skills into .claude/', () => {
  const { dir, cwd } = fixture();
  const report = installTeam(cwd, dir);

  assert.equal(readlinkSync(join(cwd, '.claude', 'agents', 'developer.md')), join(dir, 'agents', 'developer.md'));
  assert.equal(readFileSync(join(cwd, '.claude', 'commands', 'deliver.md'), 'utf8'), 'DELIVER');
  assert.equal(readFileSync(join(cwd, '.claude', 'skills', 'retro', 'SKILL.md'), 'utf8'), 'RETRO');
  assert.equal(existsSync(join(cwd, '.claude', 'skills', 'not-a-skill')), false);
  assert.equal(report.linked.length, 4);
});

test('is idempotent and leaves real files and foreign links alone', () => {
  const { root, dir, cwd } = fixture();
  mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'agents', 'developer.md'), 'HAND WRITTEN');
  writeFileSync(join(root, 'other.md'), 'OTHER');
  symlinkSync(join(root, 'other.md'), join(cwd, '.claude', 'agents', 'tester.md'));

  installTeam(cwd, dir);
  const report = installTeam(cwd, dir);

  assert.equal(readFileSync(join(cwd, '.claude', 'agents', 'developer.md'), 'utf8'), 'HAND WRITTEN');
  assert.equal(readlinkSync(join(cwd, '.claude', 'agents', 'tester.md')), join(root, 'other.md'));
  assert.equal(report.skipped.length, 2);
  assert.equal(report.settingsUpdated, false);
});

test('removes links whose team source was deleted', () => {
  const { dir, cwd } = fixture();
  installTeam(cwd, dir);
  unlinkSync(join(dir, 'agents', 'tester.md'));

  const report = installTeam(cwd, dir);

  assert.throws(() => lstatSync(join(cwd, '.claude', 'agents', 'tester.md')));
  assert.deepEqual(report.removed, [join(cwd, '.claude', 'agents', 'tester.md')]);
});

test('adds the team root to additionalDirectories, keeping existing settings', () => {
  const { dir, cwd } = fixture();
  mkdirSync(join(cwd, '.claude'));
  writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ mcpServers: { kinet: {} } }));

  installTeam(cwd, dir);
  const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'));

  assert.deepEqual(settings.mcpServers, { kinet: {} });
  assert.deepEqual(settings.permissions.additionalDirectories, [join(dir, '..')]);
});

test('lists the team and only imports context files that exist', () => {
  const { dir } = fixture();
  assert.deepEqual(listTeam(dir), { agents: ['developer', 'tester'], commands: ['deliver'], skills: ['retro'] });
  assert.deepEqual(teamContextImports(dir), [join(dir, 'knowledge', 'ways-of-working.md'), join(dir, 'team-lead.md')]);
});

test('KINET_TEAM_DIR overrides the default and expands ~', () => {
  const previous = process.env.KINET_TEAM_DIR;
  process.env.KINET_TEAM_DIR = '~/elsewhere/_shared';
  try {
    assert.ok(teamDir().endsWith('/elsewhere/_shared'));
    assert.ok(!teamDir().includes('~'));
  } finally {
    if (previous === undefined) delete process.env.KINET_TEAM_DIR;
    else process.env.KINET_TEAM_DIR = previous;
  }
});
