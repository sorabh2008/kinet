import { safeExec } from '../../utils/exec.js';
import { readPackageJson, windowsRefusal } from './npm-common.js';

const NAME = 'kinet_check_deps';
const CHECKS = ['outdated', 'audit', 'all'];
const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];
const DEP_TYPES = [
  ['dependencies', 'prod'],
  ['devDependencies', 'dev'],
  ['optionalDependencies', 'optional'],
  ['peerDependencies', 'peer'],
];
const UNREACHABLE_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET'];

export const definition = {
  name: NAME,
  description: 'Report outdated npm packages and known vulnerabilities using npm outdated/audit. Read-only; npm audit sends the dependency tree to the npm registry.',
  inputSchema: {
    type: 'object',
    properties: {
      check: { type: 'string', enum: CHECKS, default: 'all' },
    },
  },
};

class NpmError extends Error {
  constructor(code, message) {
    super(message || code || 'unknown npm error');
    this.code = code;
  }
}

// npm prints { error: { code, summary } } on failure; audit sometimes only has a top-level message.
function parseNpmJson(stdout) {
  if (!stdout.trim()) throw new NpmError(null, 'npm printed no output');
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new NpmError(null, 'npm output was not valid JSON');
  }
  if (data && data.error) {
    const text = [data.error.summary, data.message].filter(Boolean).join(' ');
    const code = data.error.code ?? UNREACHABLE_CODES.find((c) => text.includes(c)) ?? null;
    throw new NpmError(code, text);
  }
  return data;
}

function dependencyType(name, pkg) {
  const match = DEP_TYPES.find(([field]) => pkg?.[field] && Object.hasOwn(pkg[field], name));
  return match ? match[1] : 'transitive';
}

export function parseOutdated(stdout, pkg) {
  const data = parseNpmJson(stdout);
  const packages = Object.entries(data).flatMap(([name, value]) =>
    // Workspaces report one entry per workspace as an array.
    (Array.isArray(value) ? value : [value]).map((info) => ({
      name,
      current: info.current ?? 'missing',
      wanted: info.wanted,
      latest: info.latest,
      type: dependencyType(name, pkg),
    })),
  );
  return { count: packages.length, packages };
}

export function parseAudit(stdout) {
  const data = parseNpmJson(stdout);
  const meta = data.metadata?.vulnerabilities ?? {};
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, meta[s] ?? 0]));
  counts.total = meta.total ?? SEVERITIES.reduce((sum, s) => sum + counts[s], 0);
  const packages = Object.values(data.vulnerabilities ?? {}).map((v) => ({
    name: v.name,
    severity: v.severity,
    direct: Boolean(v.isDirect),
    fixAvailable: Boolean(v.fixAvailable),
  }));
  return { counts, packages };
}

function describeFailure(err, stderr) {
  if (err.code === 'ENOLOCK') return 'could not check: no lockfile (run npm install to create one)';
  if (UNREACHABLE_CODES.includes(err.code)) return `could not check: registry unreachable (${err.code})`;
  const firstStderrLine = stderr.split('\n').find((line) => line.trim());
  return `could not check: ${err.code || err.message || firstStderrLine}`;
}

async function runSection(cwd, args, parse) {
  const result = await safeExec('npm', args, { cwd, timeoutMs: 60000, maxChars: 5_000_000, keep: 'head', env: { ...process.env, NO_COLOR: '1' } });
  if (result.timedOut) return { error: 'could not check: npm timed out after 60 s' };
  try {
    return parse(result.stdout);
  } catch (err) {
    return { error: describeFailure(err, result.stderr) };
  }
}

export async function run(args = {}, ctx) {
  const { cwd } = ctx;
  const check = args.check ?? 'all';
  if (!CHECKS.includes(check)) throw new Error(`check must be one of: ${CHECKS.join(', ')}`);
  const refusal = windowsRefusal(NAME);
  if (refusal) return refusal;
  const { pkg, message } = await readPackageJson(cwd, NAME);
  if (message) return message;

  // Exit code 1 is normal for both commands when they find something, so only the JSON decides.
  const [outdated, audit] = await Promise.all([
    check === 'audit' ? null : runSection(cwd, ['outdated', '--json'], (out) => parseOutdated(out, pkg)),
    check === 'outdated' ? null : runSection(cwd, ['audit', '--json'], parseAudit),
  ]);
  return { ...(outdated && { outdated }), ...(audit && { audit }) };
}
