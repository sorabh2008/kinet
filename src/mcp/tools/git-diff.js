import { assertNoLeadingDash, resolveInsideProject } from '../../utils/args.js';
import { isGitWorkTree, notARepoMessage, gitFailure, runGit } from './git-common.js';

const NAME = 'kinet_git_diff';
const SCOPES = ['working', 'staged', 'ref'];

export const definition = {
  name: NAME,
  description: 'Show a diff stat and patch for unstaged, staged, or ref...HEAD changes. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: SCOPES, default: 'working' },
      ref: { type: 'string', description: "Required when scope is 'ref'. Diffs ref...HEAD (e.g. 'main')." },
      path: { type: 'string', description: 'Limit to a file or directory inside the project' },
    },
  },
};

function scopeArgs(scope, ref) {
  if (scope === 'staged') return ['--cached'];
  if (scope === 'ref') return [`${ref}...HEAD`];
  return [];
}

function scopeLabel(scope, ref) {
  if (scope === 'staged') return 'index vs HEAD (staged)';
  if (scope === 'ref') return `${ref}...HEAD`;
  return 'working tree vs index (unstaged)';
}

// Paths always follow `--`, so git can never read them as options (AC-0.8b), and
// --literal-pathspecs stops magic such as `:(top)` or `:/x` reaching outside the
// project directory (06-security finding 3). --no-textconv stops a committed
// .gitattributes driver running a command from a hostile .git/config (review-6b finding 1).
export function buildDiffArgs({ scope = 'working', ref, path } = {}, { stat = false } = {}) {
  return [
    '--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
    ...scopeArgs(scope, ref),
    ...(stat ? ['--stat'] : []),
    '--',
    ...(path ? [path] : []),
  ];
}

async function validateArgs(args, cwd) {
  const scope = args.scope ?? 'working';
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of: ${SCOPES.join(', ')}`);
  if (args.ref !== undefined) assertNoLeadingDash(args.ref, 'ref');
  if (scope === 'ref' && !args.ref) throw new Error('ref is required when scope is "ref"');
  const path = args.path !== undefined ? await resolveInsideProject(cwd, args.path) : undefined;
  return { scope, ref: args.ref, path };
}

export async function run(args = {}, ctx) {
  const { cwd } = ctx;
  const { scope, ref, path } = await validateArgs(args, cwd);
  if (!(await isGitWorkTree(cwd))) return notARepoMessage(cwd, NAME);

  if (scope === 'ref') {
    const verify = await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, timeoutMs: 10000 });
    if (verify.code !== 0) return `Unknown ref "${ref}": not a commit in this repository.`;
  }

  const stat = await runGit(buildDiffArgs({ scope, ref, path }, { stat: true }), { cwd, timeoutMs: 30000, maxChars: 4000 });
  if (stat.code !== 0) return gitFailure('diff', stat);
  if (!stat.stdout.trim()) {
    const untrackedNote = scope === 'working' ? ' Untracked files are not shown; see kinet_git_status.' : '';
    return `No changes (${scopeLabel(scope, ref)}).${untrackedNote}`;
  }

  const patch = await runGit(buildDiffArgs({ scope, ref, path }), { cwd, timeoutMs: 30000, maxChars: 18000, keep: 'head' });
  if (patch.code !== 0) return gitFailure('diff', patch);
  return `diff: ${scopeLabel(scope, ref)}\n\n${stat.stdout.trimEnd()}\n\n${patch.stdout}`;
}
