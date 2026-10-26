import { safeExec } from '../../utils/exec.js';
import { assertNoLeadingDash } from '../../utils/args.js';
import { clampInt } from './git-common.js';
import { readPackageJson, windowsRefusal } from './npm-common.js';

const NAME = 'kinet_run_script';

export const definition = {
  name: NAME,
  description: "Run an npm script declared in this project's package.json (e.g. test, lint, build) and return its exit code and output. WARNING: this executes project code on your machine. Call with no script to list the available scripts.",
  inputSchema: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'Name of a script in package.json. Omit to list scripts.' },
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 600, default: 120 },
    },
  },
};

// One script at a time per server, so two calls cannot fight over the same build output.
let running = null;

function listScripts(scripts) {
  const names = Object.keys(scripts);
  const width = Math.max(...names.map((n) => n.length));
  return [`scripts in package.json (${names.length}):`, ...names.map((n) => `  ${n.padEnd(width)}  ${scripts[n]}`)].join('\n');
}

function formatRun(script, command, result, timeoutSeconds) {
  const outcome = result.timedOut
    ? `result: timed out after ${timeoutSeconds} s; process group killed`
    : `exit code: ${result.code ?? `signal ${result.signal}`}`;
  return [
    `script: ${script}`,
    `command: ${command}`,
    outcome,
    `duration: ${(result.durationMs / 1000).toFixed(1)} s`,
    '--- output ---',
    result.combined,
  ].join('\n');
}

export async function run(args = {}, ctx) {
  const { cwd } = ctx;
  const refusal = windowsRefusal(NAME);
  if (refusal) return refusal;

  const { pkg, message } = await readPackageJson(cwd, NAME);
  if (message) return message;
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  if (!Object.keys(scripts).length) return 'package.json defines no scripts.';

  const { script } = args;
  if (script === undefined || script === '') return listScripts(scripts);
  assertNoLeadingDash(script, 'script');
  // hasOwn, not `in`: blocks inherited names such as __proto__ and toString.
  if (!Object.hasOwn(scripts, script)) {
    throw new Error(`Unknown script "${script}". Valid scripts: ${Object.keys(scripts).join(', ')}`);
  }
  if (running) return `A script is already running (${running}); wait for it to finish.`;

  const timeoutSeconds = clampInt(args.timeoutSeconds, { min: 1, max: 600, fallback: 120 });
  running = script;
  try {
    const result = await safeExec('npm', ['run', script], {
      cwd,
      timeoutMs: timeoutSeconds * 1000,
      keep: 'tail',
      maxChars: 18000,
      // CI=true stops test runners entering watch mode and hanging.
      env: { ...process.env, CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return formatRun(script, scripts[script], result, timeoutSeconds);
  } finally {
    running = null;
  }
}
