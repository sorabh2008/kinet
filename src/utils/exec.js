import { spawn } from 'node:child_process';

export const OUTPUT_CAP = 20000;

const KILL_GRACE_MS = 2000;
const IS_WINDOWS = process.platform === 'win32';

// Children currently running, so shutdown can kill their whole process groups
// (npm run starts grandchildren that a plain child.kill() would leave behind).
const activeChildren = new Map();

function countNewlines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}

// Lines in a dropped chunk: its newlines, plus one for a trailing partial line.
function droppedLineCount(newlines, endsWithNewline) {
  return newlines + (endsWithNewline ? 0 : 1);
}

function headMarker(lines) {
  return `\n[truncated: ${lines} more lines]`;
}

function tailMarker(lines) {
  return `[truncated: ${lines} earlier lines]\n`;
}

export function capText(text, maxChars = OUTPUT_CAP, keep = 'head') {
  if (text.length <= maxChars) return text;
  if (keep === 'tail') {
    const dropped = text.slice(0, text.length - maxChars);
    return tailMarker(droppedLineCount(countNewlines(dropped), dropped.endsWith('\n'))) + text.slice(-maxChars);
  }
  const dropped = text.slice(maxChars);
  return text.slice(0, maxChars) + headMarker(droppedLineCount(countNewlines(dropped), dropped.endsWith('\n')));
}

// Collects streamed output without holding more than about 2x maxChars in memory.
function createCollector(maxChars, keep) {
  let kept = '';
  let droppedNewlines = 0;
  let droppedAny = false;
  let droppedEndsWithNewline = true;

  function dropFromStart(count) {
    const dropped = kept.slice(0, count);
    droppedNewlines += countNewlines(dropped);
    droppedEndsWithNewline = dropped.endsWith('\n');
    droppedAny = true;
    kept = kept.slice(count);
  }

  return {
    push(chunk) {
      if (keep === 'tail') {
        kept += chunk;
        if (kept.length > 2 * maxChars) dropFromStart(kept.length - maxChars);
        return;
      }
      const room = maxChars - kept.length;
      if (room >= chunk.length) {
        kept += chunk;
        return;
      }
      if (room > 0) kept += chunk.slice(0, room);
      const dropped = chunk.slice(Math.max(room, 0));
      droppedNewlines += countNewlines(dropped);
      droppedEndsWithNewline = dropped.endsWith('\n');
      droppedAny = true;
    },
    result() {
      if (keep === 'tail' && kept.length > maxChars) dropFromStart(kept.length - maxChars);
      if (!droppedAny) return { text: kept, truncated: false };
      const lines = droppedLineCount(droppedNewlines, droppedEndsWithNewline);
      const text = keep === 'tail' ? tailMarker(lines) + kept : kept + headMarker(lines);
      return { text, truncated: true };
    },
  };
}

function signalGroup(child, signal) {
  try {
    if (IS_WINDOWS) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }
}

// Synchronous on purpose so it can run inside process.on('exit').
export function killActiveProcessGroups(signal = 'SIGTERM') {
  let count = 0;
  for (const child of activeChildren.values()) {
    signalGroup(child, signal);
    count++;
  }
  return count;
}

export function safeExec(cmd, args, { cwd, timeoutMs = 120000, maxChars = OUTPUT_CAP, keep = 'head', env } = {}) {
  const childEnv = { ...(env ?? process.env) };
  // The daemon token must never reach project code (review-2 finding 4).
  delete childEnv.KINET_MCP_TOKEN;

  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !IS_WINDOWS,
      windowsHide: true,
      env: childEnv,
    });
    const stdout = createCollector(maxChars, keep);
    const stderr = createCollector(maxChars, keep);
    const combined = createCollector(maxChars, keep);
    let timedOut = false;
    let killTimer;

    if (child.pid) activeChildren.set(child.pid, child);

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout.push(chunk); combined.push(chunk); });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr.push(chunk); combined.push(chunk); });

    child.once('error', (err) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      activeChildren.delete(child.pid);
      reject(err.code === 'ENOENT' ? new Error(`${cmd} not found on PATH`) : err);
    });

    child.once('close', (code, signal) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      activeChildren.delete(child.pid);
      const out = stdout.result();
      const err = stderr.result();
      const all = combined.result();
      resolve({
        code,
        signal,
        stdout: out.text,
        stderr: err.text,
        combined: all.text,
        timedOut,
        truncated: out.truncated || err.truncated || all.truncated,
        durationMs: Math.round(performance.now() - started),
      });
    });
  });
}
