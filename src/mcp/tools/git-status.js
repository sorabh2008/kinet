import { safeExec } from '../../utils/exec.js';
import { isGitWorkTree, notARepoMessage, gitFailure, clampInt } from './git-common.js';

const NAME = 'kinet_git_status';
const FIELD_SEP = '\x1f';

export const definition = {
  name: NAME,
  description: 'Show the current git branch, upstream ahead/behind, staged/unstaged/untracked files and recent commits. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      commits: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Number of recent commits to include' },
    },
  },
};

// Parses `git status --porcelain=v2 --branch` (see git-status(1), "Porcelain Format Version 2").
export function parsePorcelainV2(stdout) {
  const status = { head: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], conflicted: [] };
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) status.head = line.slice('# branch.head '.length);
    else if (line.startsWith('# branch.oid ')) status.oid = line.slice('# branch.oid '.length);
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice('# branch.upstream '.length);
    else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice('# branch.ab '.length).split(' ');
      status.ahead = Number(ahead.replace('+', ''));
      status.behind = Number(behind.replace('-', ''));
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const fields = line.split(' ');
      const xy = fields[1];
      const isRename = line.startsWith('2 ');
      const pathPart = fields.slice(isRename ? 9 : 8).join(' ');
      const [path, orig] = pathPart.split('\t');
      const shown = isRename ? `${path} <- ${orig}` : path;
      if (xy[0] !== '.') status.staged.push(`${xy[0]} ${shown}`);
      if (xy[1] !== '.') status.unstaged.push(`${xy[1]} ${shown}`);
    } else if (line.startsWith('u ')) {
      status.conflicted.push(line.split(' ').slice(10).join(' '));
    } else if (line.startsWith('? ')) {
      status.untracked.push(line.slice(2));
    }
  }
  return status;
}

function branchLine(status) {
  if (status.head === '(detached)') return `branch: (detached HEAD at ${status.oid.slice(0, 7)})`;
  if (status.oid === '(initial)') return `branch: ${status.head} (no commits yet)`;
  if (!status.upstream) return `branch: ${status.head} (no upstream)`;
  return `branch: ${status.head} (upstream ${status.upstream}, ahead ${status.ahead}, behind ${status.behind})`;
}

function listSection(label, items) {
  if (!items.length) return [`${label}: none`];
  return [`${label} (${items.length}):`, ...items.map((item) => `  ${item}`)];
}

function commitSection(status, logResult) {
  if (logResult.code !== 0) {
    if (status.oid === '(initial)') return ['recent commits: none (no commits yet)'];
    return [`recent commits: ${gitFailure('log', logResult)}`];
  }
  const commits = logResult.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, author, date, subject] = line.split(FIELD_SEP);
    return `${hash}  ${date}  ${author}  ${subject}`;
  });
  return listSection('recent commits', commits);
}

export async function run(args = {}, ctx) {
  const { cwd } = ctx;
  if (!(await isGitWorkTree(cwd))) return notARepoMessage(cwd, NAME);

  const commits = clampInt(args.commits, { min: 1, max: 50, fallback: 10 });
  // --no-optional-locks: a read-only tool must never take .git/index.lock while the user runs git.
  const [statusResult, logResult] = await Promise.all([
    safeExec('git', ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 10000 }),
    safeExec('git', ['--no-optional-locks', 'log', `-n${commits}`, '--format=%h%x1f%an%x1f%aI%x1f%s'], { cwd, timeoutMs: 10000 }),
  ]);
  if (statusResult.code !== 0) return gitFailure('status', statusResult);

  const status = parsePorcelainV2(statusResult.stdout);
  return [
    branchLine(status),
    ...listSection('staged', status.staged),
    ...listSection('unstaged', status.unstaged),
    ...listSection('untracked', status.untracked),
    ...listSection('conflicted', status.conflicted),
    ...commitSection(status, logResult),
    '(paths are relative to the repository root)',
  ].join('\n');
}
