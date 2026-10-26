import { safeExec } from '../../utils/exec.js';

// Every git call goes through here. A project unpacked from an archive can ship
// its own .git/config, and core.fsmonitor names a command git would run for us
// (review-6b finding 1), so it is always switched off.
export function runGit(args, options) {
  return safeExec('git', ['-c', 'core.fsmonitor=false', ...args], options);
}

// Shared by the git-backed tools so they all report "not a repo" and git
// failures the same way.
export async function isGitWorkTree(cwd) {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd, timeoutMs: 10000 });
  return result.code === 0 && result.stdout.trim() === 'true';
}

export function notARepoMessage(cwd, toolName) {
  return `Not a git repository: ${cwd}. ${toolName} needs a git work tree.`;
}

export function gitFailure(subcommand, result) {
  const reason = result.timedOut ? 'timed out' : `exit ${result.code}`;
  return `git ${subcommand} failed (${reason}): ${result.stderr.trim().slice(0, 500)}`;
}

// Non-numbers fall back to the default; numbers are clamped rather than refused.
export function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (value === undefined || value === null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
