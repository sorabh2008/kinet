import { join, dirname, resolve, sep, basename } from 'path';
import { homedir } from 'os';
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync,
} from 'fs';

/**
 * The delivery team (role agents, slash commands, skills, routing rules) lives
 * outside KINET in a personal "team dir" — by default ~/second-brain/_shared.
 * KINET only links it into each project, so edits made there (e.g. by the
 * end-of-task retro) apply to every project immediately.
 */
export function teamDir() {
  const dir = process.env.KINET_TEAM_DIR || join(homedir(), 'second-brain', '_shared');
  return resolve(dir.replace(/^~(?=$|\/)/, homedir()));
}

// The team's shared files that every session should load, in import order.
const CONTEXT_FILES = ['knowledge/ways-of-working.md', 'knowledge/coding-standards.md', 'team-lead.md'];

export function teamContextImports(dir = teamDir()) {
  return CONTEXT_FILES.map(f => join(dir, f)).filter(existsSync);
}

export function listTeam(dir = teamDir()) {
  const mdNames = sub => (existsSync(join(dir, sub))
    ? readdirSync(join(dir, sub)).filter(f => f.endsWith('.md')).sort()
    : []);
  const skills = existsSync(join(dir, 'skills'))
    ? readdirSync(join(dir, 'skills')).filter(name => existsSync(join(dir, 'skills', name, 'SKILL.md'))).sort()
    : [];
  return {
    agents: mdNames('agents').map(f => basename(f, '.md')),
    commands: mdNames('commands').map(f => basename(f, '.md')),
    skills,
  };
}

function isSymlink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function pointsInto(link, root) {
  return resolve(dirname(link), readlinkSync(link)).startsWith(root + sep);
}

// Replace only links KINET owns (pointing into the team dir); never clobber a real file.
function link(src, dst, root, report) {
  if (isSymlink(dst)) {
    if (resolve(dirname(dst), readlinkSync(dst)) === src) {
      report.linked.push(dst);
      return;
    }
    if (!pointsInto(dst, root)) {
      report.skipped.push(`${dst} (symlink to something else — left alone)`);
      return;
    }
    unlinkSync(dst);
  } else if (existsSync(dst)) {
    report.skipped.push(`${dst} (existing file — left alone)`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(src, dst);
  report.linked.push(dst);
}

function removeStaleLinks(directory, root, report) {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (isSymlink(path) && !existsSync(path) && pointsInto(path, root)) {
      unlinkSync(path);
      report.removed.push(path);
    }
  }
}

// Let the project's Claude sessions edit the team dir's root (retros commit there).
function allowTeamRoot(cwd, root) {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return false; }
  }
  settings.permissions = settings.permissions || {};
  const dirs = settings.permissions.additionalDirectories || [];
  if (dirs.includes(root)) return false;
  settings.permissions.additionalDirectories = [...dirs, root];
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return true;
}

/**
 * Link the team's agents, commands and skills into `<cwd>/.claude/`.
 * Returns null when no team dir exists, so KINET still works without one.
 */
export function installTeam(cwd, dir = teamDir()) {
  if (!existsSync(join(dir, 'agents'))) return null;

  const report = { linked: [], skipped: [], removed: [], settingsUpdated: false };
  const claudeDir = join(cwd, '.claude');
  const team = listTeam(dir);

  for (const name of team.agents) {
    link(join(dir, 'agents', `${name}.md`), join(claudeDir, 'agents', `${name}.md`), dir, report);
  }
  for (const name of team.commands) {
    link(join(dir, 'commands', `${name}.md`), join(claudeDir, 'commands', `${name}.md`), dir, report);
  }
  for (const name of team.skills) {
    link(join(dir, 'skills', name), join(claudeDir, 'skills', name), dir, report);
  }
  for (const sub of ['agents', 'commands', 'skills']) removeStaleLinks(join(claudeDir, sub), dir, report);

  report.settingsUpdated = allowTeamRoot(cwd, dirname(dir));
  return report;
}
