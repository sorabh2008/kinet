import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MARKER = '# KINET — generated/local files (remove these lines to commit them instead)';
const ENTRIES = ['.claude', '.kinet', 'CLAUDE.md', 'kinet.config.json'];

/**
 * Ensures KINET's generated files are listed in .gitignore.
 * Only appends entries that are missing — never touches existing lines.
 * Returns true if the file was changed.
 */
export function updateGitignore(cwd) {
  const path = join(cwd, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const existingLines = new Set(existing.split('\n').map(l => l.trim()));

  const missing = ENTRIES.filter(entry => !existingLines.has(entry));
  if (missing.length === 0) return false;

  const normalized = existing.length === 0 ? '' : existing.replace(/\n*$/, '\n');
  const block = `${normalized ? '\n' : ''}${MARKER}\n${missing.join('\n')}\n`;

  writeFileSync(path, normalized + block);
  return true;
}
