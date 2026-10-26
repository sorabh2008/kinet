import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { resolveInsideProject } from '../../utils/args.js';
import { TICKET_MARKERS, markersIn, hasTicketRef } from '../../rules/patterns.js';
import { isGitWorkTree, gitFailure, runGit } from './git-common.js';

const MAX_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;
const TEXT_LIMIT = 200;
const RESULTS_CHAR_BUDGET = 18000;

export const definition = {
  name: 'kinet_find_todos',
  description: `List ${TICKET_MARKERS.join('/')} markers (uppercase, whole word) with file and line, flagging those without a ticket reference like [PROJ-123] (same rule as kinet validate).`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Subdirectory or file to scan (default: project root)' },
      missingTicketOnly: { type: 'boolean', default: false },
    },
  },
};

// The glob pathspec excludes node_modules at any depth, gitignored or not;
// the path always follows `--` (AC-0.8b) and is marked `:(literal)` so pathspec
// magic in it cannot reach outside the project (06-security finding 3).
export function buildGrepArgs(scanPath = '.') {
  return ['grep', '-z', '-n', '-I', '--untracked', '-w', '-E', TICKET_MARKERS.join('|'), '--', `:(literal)${scanPath}`, ':(exclude,glob)**/node_modules/**'];
}

function toResult(file, line, text) {
  const markers = markersIn(text);
  if (!markers.length) return null;
  return { file, line, marker: markers[0], hasTicket: hasTicketRef(text), text: text.trim().slice(0, TEXT_LIMIT) };
}

// `git grep -z -n` prints `path\0line\0text` per match, so a ":" in a filename cannot break parsing.
export function parseGrepOutput(stdout) {
  const results = [];
  for (const record of stdout.split('\n')) {
    const first = record.indexOf('\0');
    const second = record.indexOf('\0', first + 1);
    if (first < 0 || second < 0) continue;
    const result = toResult(record.slice(0, first), Number(record.slice(first + 1, second)), record.slice(second + 1));
    if (result) results.push(result);
  }
  return results;
}

async function scanWithGit(cwd, rel) {
  const result = await runGit(buildGrepArgs(rel), { cwd, maxChars: 2_000_000, timeoutMs: 30000 });
  if (result.code === 1) return [];
  if (result.code !== 0) throw new Error(gitFailure('grep', result));
  return parseGrepOutput(result.stdout);
}

async function looksBinary(absFile) {
  const handle = await open(absFile, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(BINARY_SNIFF_BYTES), 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function scanFile(cwd, absFile) {
  const info = await stat(absFile);
  if (info.size > MAX_FILE_BYTES || (await looksBinary(absFile))) return [];
  const file = path.relative(cwd, absFile);
  const lines = (await readFile(absFile, 'utf8')).split('\n');
  return lines.flatMap((text, i) => toResult(file, i + 1, text) ?? []);
}

async function scanWithoutGit(cwd, rel) {
  const base = path.join(cwd, rel);
  if ((await stat(base)).isFile()) return scanFile(cwd, base);
  const files = await glob('**/*', { cwd: base, nodir: true, dot: true, ignore: ['**/node_modules/**', '**/.git/**'] });
  const results = [];
  // One file at a time keeps memory flat on large trees.
  for (const file of files.sort()) results.push(...(await scanFile(cwd, path.join(base, file))));
  return results;
}

function withinBudget(entries) {
  const kept = [];
  let used = 0;
  for (const entry of entries) {
    used += JSON.stringify(entry).length;
    if (used > RESULTS_CHAR_BUDGET) break;
    kept.push(entry);
  }
  return kept;
}

export async function run(args = {}, ctx) {
  const { cwd } = ctx;
  const rel = args.path !== undefined ? await resolveInsideProject(cwd, args.path) : '.';
  try {
    await stat(path.join(cwd, rel));
  } catch {
    return `Path not found: ${args.path}`;
  }

  const all = (await isGitWorkTree(cwd)) ? await scanWithGit(cwd, rel) : await scanWithoutGit(cwd, rel);
  const missingTicket = all.filter((r) => !r.hasTicket).length;
  const listed = args.missingTicketOnly ? all.filter((r) => !r.hasTicket) : all;
  const results = withinBudget(listed);

  const output = { total: all.length, missingTicket, results };
  if (results.length < listed.length) output.truncated = `[truncated: ${listed.length - results.length} more results]`;
  return output;
}
