import { join } from 'path';
import { mkdirSync, symlinkSync, existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(__dirname, '../../templates/claude-commands');

export async function installClaudeCommands(cwd, stack) {
  const commandsDir = join(cwd, '.claude', 'commands');
  mkdirSync(commandsDir, { recursive: true });

  const stackDir = join(TEMPLATES, stack);
  const commands = ['plan.md', 'pr-review.md', 'security.md'];

  for (const filename of commands) {
    const src = join(stackDir, filename);
    const dst = join(commandsDir, filename);
    if (existsSync(dst)) unlinkSync(dst);
    symlinkSync(src, dst);
  }

  // commit.md is stack-agnostic
  const commitSrc = join(TEMPLATES, 'commit.md');
  const commitDst = join(commandsDir, 'commit.md');
  if (existsSync(commitDst)) unlinkSync(commitDst);
  symlinkSync(commitSrc, commitDst);
}
