import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { InvalidArgumentError } from 'commander';

// A value starting with "-" would be read by git/npm as an option (e.g. --output=<file>).
export function assertNoLeadingDash(value, name) {
  if (typeof value !== 'string') throw new Error(`Refusing ${name}: it must be a string.`);
  if (value.startsWith('-')) {
    throw new Error(`Refusing ${name} "${value}": values starting with "-" are not allowed.`);
  }
}

function escapesBase(rel) {
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
}

async function realpathOrNull(p) {
  try {
    return await realpath(p);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

// Returns the path relative to the project, refusing anything outside it.
// Paths that do not exist are allowed (a deleted file is a valid diff path).
export async function resolveInsideProject(cwd, p) {
  assertNoLeadingDash(p, 'path');
  const refuse = () => new Error(`Refusing path "${p}": it is outside the project directory.`);

  const abs = path.resolve(cwd, p);
  const lexical = path.relative(cwd, abs);
  if (escapesBase(lexical)) throw refuse();

  const realAbs = await realpathOrNull(abs);
  if (!realAbs) return lexical || '.';

  // Re-check after resolving symlinks so a link inside the project cannot point outside it.
  const real = path.relative(await realpath(cwd), realAbs);
  if (escapesBase(real)) throw refuse();
  return real || '.';
}

function parseIntegerString(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : NaN;
}

export function parsePort(value) {
  const port = parseIntegerString(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError('must be an integer 1-65535');
  }
  return port;
}

export function parsePositiveInt(value) {
  const n = parseIntegerString(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
}
