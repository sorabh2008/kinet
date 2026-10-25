// Run state for the background MCP server, kept per project in <cwd>/.kinet/run/.
// Used by the CLI side only; the daemon itself never writes these files.
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeExec } from '../utils/exec.js';

export const DEFAULT_PORT = 7345;

// A start never legitimately holds the lock this long (the health wait is 4 s).
const LOCK_STALE_MS = 10000;

export class LockHeldError extends Error {
  constructor(pid) {
    super(`another 'kinet mcp start' is running for this project (pid ${pid}).`);
    this.pid = pid;
  }
}

export class UnsafeRunDirError extends Error {}

// Append-only log open that refuses a symlink planted at the log path.
export const LOG_OPEN_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);

export function runPaths(cwd) {
  const dir = join(cwd, '.kinet', 'run');
  return {
    dir,
    state: join(dir, 'mcp.json'),
    tmp: join(dir, 'mcp.json.tmp'),
    lock: join(dir, 'mcp.lock'),
    log: join(dir, 'mcp.log'),
    prevLog: join(dir, 'mcp.log.1'),
    gitignore: join(dir, '.gitignore'),
  };
}

async function ignoreMissing(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

async function refuseSymlink(p) {
  const info = await ignoreMissing(lstat(p));
  if (info?.isSymbolicLink()) {
    throw new UnsafeRunDirError(`refusing to use ${p}: it is a symlink. Remove it and try again.`);
  }
}

// The run dir ignores itself, so run files are never committed even without `kinet init`.
// A cloned repo could plant `.kinet` or `.kinet/run` as symlinks to redirect our writes,
// so both are refused if they are links (06-security finding 1).
export async function ensureRunDir(cwd) {
  const paths = runPaths(cwd);
  await refuseSymlink(join(cwd, '.kinet'));
  await refuseSymlink(paths.dir);
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(paths.gitignore, '*\n', { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return paths;
}

export async function readState(cwd) {
  const text = await ignoreMissing(readFile(runPaths(cwd).state, 'utf8'));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Written to a temp file then renamed, so readers never see a half-written file.
// The temp file is unlinked and re-created with O_EXCL ('wx'), which never follows
// a symlink planted at that path.
export async function writeState(cwd, state) {
  const { tmp, state: target } = runPaths(cwd);
  await ignoreMissing(unlink(tmp));
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(state));
  } finally {
    await handle.close();
  }
  await rename(tmp, target);
}

export async function clearState(cwd) {
  await ignoreMissing(unlink(runPaths(cwd).state));
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Locks are written atomically (see createLock), so an empty or unparsable lock
// can only be debris from a crash: it is stale (BUG-1).
async function lockIsStale(lockPath) {
  const text = await ignoreMissing(readFile(lockPath, 'utf8'));
  if (text === null) return { stale: true };
  try {
    const lock = JSON.parse(text);
    const old = Date.now() - Date.parse(lock.createdAt) > LOCK_STALE_MS;
    return { stale: !isPidAlive(lock.pid) || old, pid: lock.pid };
  } catch {
    return { stale: true, pid: 'unknown' };
  }
}

export function lockTmpPath(lockPath, pid = process.pid) {
  return `${lockPath}.${pid}.tmp`;
}

// The lock content is written to a private temp file first and then hard-linked
// into place: link() fails with EEXIST if the lock exists, and the lock can never
// be seen empty, even if the process dies mid-way (BUG-1).
async function createLock(lockPath) {
  const tmp = lockTmpPath(lockPath);
  await ignoreMissing(unlink(tmp));
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  } finally {
    await handle.close();
  }
  try {
    await link(tmp, lockPath);
  } finally {
    await ignoreMissing(unlink(tmp));
  }
  return async () => {
    await ignoreMissing(unlink(lockPath));
  };
}

// A lock left by an interrupted start (dead owner, or older than 10 s) is
// removed and the create retried once (review-2 finding 2).
export async function acquireLock(cwd) {
  const { lock } = runPaths(cwd);
  try {
    return await createLock(lock);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const { stale, pid } = await lockIsStale(lock);
  if (!stale) throw new LockHeldError(pid);
  await ignoreMissing(unlink(lock));
  try {
    return await createLock(lock);
  } catch (err) {
    if (err.code === 'EEXIST') throw new LockHeldError(pid);
    throw err;
  }
}

export async function probeHealth(port, token, timeoutMs = 1000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'X-Kinet-Token': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = res.status === 200 ? await res.json() : undefined;
    return { status: res.status, body };
  } catch (err) {
    return { error: err.cause?.code ?? err.name ?? 'ERROR' };
  }
}

// `ps` etime is [[dd-]hh:]mm:ss.
export function parseElapsed(etime) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!match) return null;
  const [, d = 0, h = 0, m, s] = match.map((part) => (part === undefined ? undefined : Number(part)));
  return ((d * 24 + h) * 60 + m) * 60 + s;
}

// The daemon is always spawned as `<node> <...>/bin/kinet.js mcp --port <port>` and
// it started before it recorded startedAt. Both must hold for the pid to be ours.
// Anything we cannot confirm (no ps, e.g. Windows) counts as not ours: never signal it.
export async function looksLikeOurDaemon({ pid, port, startedAt }) {
  let result;
  try {
    result = await safeExec('ps', ['-o', 'etime=', '-o', 'command=', '-p', String(pid)], {
      timeoutMs: 5000,
      env: { ...process.env, LC_ALL: 'C' },
    });
  } catch {
    return false;
  }
  const line = result.stdout.trim();
  if (result.code !== 0 || !line) return false;
  const [etime, ...commandParts] = line.split(/\s+/);
  const command = commandParts.join(' ');
  if (!/(^|[/\\])kinet\.js mcp --port /.test(command) || !command.endsWith(`mcp --port ${port}`)) return false;
  const elapsed = parseElapsed(etime);
  if (elapsed === null) return false;
  // etime is whole seconds rounded down, so allow one second of slack.
  const processStart = Date.now() - elapsed * 1000;
  return processStart <= Date.parse(startedAt) + 1000;
}

// D5: running only if our pid answers on our port with our token, for the
// project directory this command runs in.
// Pure: it never deletes anything; callers decide what to clear.
export async function checkIdentity(cwd) {
  const state = await readState(cwd);
  if (!state) return { state: 'stopped' };
  // A state file copied with the project (cp -R, rsync, restore) points at the
  // original project's server; it must never count as ours (06-test-plan F-5).
  const projectRoot = await realpath(cwd);
  if (state.cwd !== projectRoot) return { state: 'stale', reason: 'state belongs to another project directory' };
  if (!isPidAlive(state.pid)) return { state: 'stale', reason: 'process is gone' };
  const health = await probeHealth(state.port, state.token);
  // Our port accepted the connection but never answered: the server is alive but
  // hung (blocked loop, SIGSTOP, slow wake). Keep the state so `stop` can still
  // force-kill it instead of orphaning it (06-test-plan F-1).
  // A live pid alone is not proof (review-6a finding 2), so the process must
  // also look like our daemon before we report it as ours or signal it.
  if (health.error === 'TimeoutError') {
    if (!(await looksLikeOurDaemon(state))) return { state: 'stale', reason: 'pid is not this project\'s server' };
    return { state: 'unresponsive', info: { ...state, uptimeMs: Date.now() - Date.parse(state.startedAt) } };
  }
  if (health.status !== 200) return { state: 'stale', reason: `health check failed (${health.status ?? health.error})` };
  if (health.body.pid !== state.pid || health.body.cwd !== projectRoot) {
    return { state: 'stale', reason: 'a different server answered' };
  }
  return { state: 'running', info: { ...state, uptimeMs: Date.now() - Date.parse(state.startedAt) } };
}
