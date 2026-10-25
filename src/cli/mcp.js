// `kinet mcp start|status|stop|logs`: manage one background HTTP/SSE MCP server per project.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unwatchFile, watchFile } from 'node:fs';
import { open, readFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ensureRunDir, runPaths, writeState, clearState, acquireLock, probeHealth, checkIdentity, isPidAlive, LockHeldError,
} from '../mcp/runstate.js';

const BIN_PATH = fileURLToPath(new URL('../../bin/kinet.js', import.meta.url));
const HEALTH_TIMEOUT_MS = 4000;
const POLL_MS = 100;
const PORT_IN_USE_EXIT = 3;
const STOP_GRACE_MS = 5000;
const FOLLOW_INTERVAL_MS = 250;
const IS_WINDOWS = process.platform === 'win32';

function out(text) {
  process.stdout.write(`${text}\n`);
}

function fail(text) {
  process.stderr.write(`Error: ${text}\n`);
  process.exitCode = 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function formatUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function lastLines(text, n) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const tail = lines.slice(-n);
  return tail.length ? `${tail.join('\n')}\n` : '';
}

function urlFor(port) {
  return `http://127.0.0.1:${port}/sse`;
}

function serverBlock(header, { pid, port, logPath }) {
  return [header, `  pid:  ${pid}`, `  port: ${port}`, `  url:  ${urlFor(port)}`, `  log:  ${logPath}`].join('\n');
}

function killGroup(pid, signal) {
  try {
    if (IS_WINDOWS) process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }
}

// Synchronous kill so it is safe inside a signal handler; the detached child
// does not receive the terminal's Ctrl-C, so it must be killed explicitly.
export function abortStart(child, release) {
  killGroup(child.pid, 'SIGKILL');
  release().catch(() => {});
}

// Resolves { body } once the child answers /health, { exitCode } if it dies, or { timedOut }.
async function waitForHealthy(child, port, token) {
  let exited = null;
  const onExit = (code) => { exited = { exitCode: code }; };
  child.once('exit', onExit);
  try {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) return exited;
      const health = await probeHealth(port, token, 500);
      if (health.status === 200 && health.body.pid === child.pid) return { body: health.body };
      await sleep(POLL_MS);
    }
    return exited ?? { timedOut: true };
  } finally {
    child.off('exit', onExit);
  }
}

async function logTail(logPath, n = 20) {
  try {
    return lastLines(await readFile(logPath, 'utf8'), n);
  } catch {
    return '';
  }
}

async function rotateLog(paths) {
  try {
    await rename(paths.log, paths.prevLog);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function spawnDaemon(cwd, port, token, logPath) {
  const logFile = await open(logPath, 'a', 0o600);
  try {
    // The token goes in the environment, not argv, so it never shows up in `ps`.
    return spawn(process.execPath, [BIN_PATH, 'mcp', '--port', String(port)], {
      cwd,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
      env: { ...process.env, KINET_MCP_TOKEN: token },
    });
  } finally {
    await logFile.close();
  }
}

async function reportStartFailure(result, port, logPath) {
  if (result.exitCode === PORT_IN_USE_EXIT) {
    return fail(`port ${port} is in use. Try: kinet mcp start --port <other>`);
  }
  const reason = result.timedOut
    ? `MCP server did not become healthy within ${HEALTH_TIMEOUT_MS / 1000} s.`
    : `MCP server exited during startup (code ${result.exitCode}).`;
  fail(`${reason} Last log lines:\n${await logTail(logPath)}`);
}

export async function runMcpStart({ port }) {
  const cwd = process.cwd();
  const paths = await ensureRunDir(cwd);
  let release;
  try {
    release = await acquireLock(cwd);
  } catch (err) {
    if (err instanceof LockHeldError) return fail(err.message);
    throw err;
  }

  let onSignal;
  try {
    const identity = await checkIdentity(cwd);
    if (identity.state === 'running') return out(serverBlock('KINET MCP server already running', identity.info));
    if (identity.state === 'stale') await clearState(cwd);

    const token = randomBytes(32).toString('hex');
    await rotateLog(paths);
    const child = await spawnDaemon(cwd, port, token, paths.log);

    onSignal = () => {
      abortStart(child, release);
      process.exit(130);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    const result = await waitForHealthy(child, port, token);
    if (!result.body) {
      if (child.exitCode === null && child.signalCode === null) killGroup(child.pid, 'SIGKILL');
      return await reportStartFailure(result, port, paths.log);
    }

    const { cwd: realCwd, startedAt, version } = result.body;
    await writeState(cwd, { pid: child.pid, port, token, cwd: realCwd, startedAt, logPath: paths.log, version });
    child.unref();
    out(serverBlock('KINET MCP server started', { pid: child.pid, port, logPath: paths.log }));
  } finally {
    if (onSignal) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
    await release();
  }
}

export async function runMcpStatus() {
  const cwd = process.cwd();
  const identity = await checkIdentity(cwd);
  if (identity.state === 'running') {
    const { pid, port, uptimeMs, logPath } = identity.info;
    out(['running', `  pid:    ${pid}`, `  port:   ${port}`, `  url:    ${urlFor(port)}`, `  uptime: ${formatUptime(uptimeMs)}`, `  log:    ${logPath}`].join('\n'));
    return;
  }
  if (identity.state === 'stale') {
    await clearState(cwd);
    out('stopped (stale)');
  } else {
    out('stopped');
  }
  process.exitCode = 1;
}

async function requestShutdown(port, token) {
  try {
    await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: 'POST',
      headers: { 'X-Kinet-Token': token },
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // A server that does not answer is force-killed below.
  }
}

async function waitForExit(pid, graceMs, pollMs) {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(pollMs);
  }
  return !isPidAlive(pid);
}

// Signals only a process that checkIdentity has just confirmed is this
// project's server (AC-9.3); graceMs/pollMs are injectable for tests.
export async function runMcpStop({ cwd = process.cwd(), graceMs = STOP_GRACE_MS, pollMs = POLL_MS } = {}) {
  const identity = await checkIdentity(cwd);
  if (identity.state === 'stopped') return out('not running');
  if (identity.state === 'stale') {
    await clearState(cwd);
    return out('not running (cleared stale state)');
  }

  const { pid, port, token } = identity.info;
  await requestShutdown(port, token);
  let forced = false;
  if (!(await waitForExit(pid, graceMs, pollMs))) {
    try {
      process.kill(pid, 'SIGKILL');
      forced = true;
    } catch (err) {
      if (err.code !== 'ESRCH') return fail(`could not stop pid ${pid}: ${err.code}`);
    }
  }
  await clearState(cwd);
  out(forced ? `stopped (pid ${pid}, force-killed after ${graceMs / 1000} s)` : `stopped (pid ${pid})`);
}

async function readRange(logPath, start, end) {
  const handle = await open(logPath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(end - start), 0, end - start, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// fs.watchFile polls, so it works the same on every OS and adds no dependency.
function followLog(logPath, startOffset) {
  let offset = startOffset;
  let pending = Promise.resolve();
  watchFile(logPath, { interval: FOLLOW_INTERVAL_MS }, (curr) => {
    pending = pending.then(async () => {
      try {
        if (curr.size < offset) offset = 0; // rotated or truncated by a new start
        if (curr.size === offset) return;
        process.stdout.write(await readRange(logPath, offset, curr.size));
        offset = curr.size;
      } catch (err) {
        if (err.code !== 'ENOENT') process.stderr.write(`Error: could not read ${logPath}: ${err.message}\n`);
      }
    });
  });
  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      unwatchFile(logPath);
      resolve();
    });
  });
}

export async function runMcpLogs({ lines = 50, follow = false, cwd = process.cwd() } = {}) {
  const logPath = runPaths(cwd).log;
  let text;
  try {
    text = await readFile(logPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return fail(`no logs — has \`kinet mcp start\` been run? (looked for ${logPath})`);
  }
  process.stdout.write(lastLines(text.toString('utf8'), lines));
  if (follow) await followLog(logPath, text.length);
}
