// Shared test helpers. Not matched by `node --test` (no .test.js suffix) and
// excluded from the npm tarball via package.json "files".
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKET_MARKERS } from '../rules/patterns.js';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BIN_PATH = join(REPO_ROOT, 'bin', 'kinet.js');
export const MARKER = TICKET_MARKERS[0];

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function tempDir(prefix = 'kinet-test-') {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

export async function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const abs = join(dir, name);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

export function run(cmd, args, { cwd, env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

export async function git(cwd, ...args) {
  const result = await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

export async function gitRepo(dir, files = {}) {
  await git(dir, 'init', '-q', '-b', 'main');
  if (Object.keys(files).length) {
    await writeFiles(dir, files);
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-q', '-m', 'initial');
  }
  return dir;
}

export function runCli(args, { cwd, env } = {}) {
  return run(process.execPath, [BIN_PATH, ...args], { cwd, env });
}

export async function waitFor(fn, timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
