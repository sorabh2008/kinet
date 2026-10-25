// Run state for the background MCP server, kept per project in <cwd>/.kinet/run/.
// Used by the CLI side only; the daemon itself never writes these files.
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_PORT = 7345;

// A start never legitimately holds the lock this long (the health wait is 4 s).
const LOCK_STALE_MS = 10000;

export class LockHeldError extends Error {
  constructor(pid) {
    super(`another 'kinet mcp start' is running for this project (pid ${pid}).`);
    this.pid = pid;
  }
}

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

// The run dir ignores itself, so run files are never committed even without `kinet init`.
export async function ensureRunDir(cwd) {
  const paths = runPaths(cwd);
  await mkdir(paths.dir, { recursive: true });
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
export async function writeState(cwd, state) {
  const { tmp, state: target } = runPaths(cwd);
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
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

async function lockIsStale(lockPath) {
  const text = await ignoreMissing(readFile(lockPath, 'utf8'));
  if (text === null) return { stale: true };
  try {
    const lock = JSON.parse(text);
    const old = Date.now() - Date.parse(lock.createdAt) > LOCK_STALE_MS;
    return { stale: !isPidAlive(lock.pid) || old, pid: lock.pid };
  } catch {
    const info = await ignoreMissing(stat(lockPath));
    return { stale: !info || Date.now() - info.mtimeMs > LOCK_STALE_MS, pid: 'unknown' };
  }
}

async function createLock(lockPath) {
  const handle = await open(lockPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  } finally {
    await handle.close();
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

// D5: running only if our pid answers on our port with our token for our cwd.
// Pure: it never deletes anything; callers decide what to clear.
export async function checkIdentity(cwd) {
  const state = await readState(cwd);
  if (!state) return { state: 'stopped' };
  if (!isPidAlive(state.pid)) return { state: 'stale', reason: 'process is gone' };
  const health = await probeHealth(state.port, state.token);
  if (health.status !== 200) return { state: 'stale', reason: `health check failed (${health.status ?? health.error})` };
  if (health.body.pid !== state.pid || health.body.cwd !== state.cwd) {
    return { state: 'stale', reason: 'a different server answered' };
  }
  return { state: 'running', info: { ...state, uptimeMs: Date.now() - Date.parse(state.startedAt) } };
}
