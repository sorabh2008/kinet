import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN = join(__dirname, '../../templates/skills');

/**
 * Load a skill definition. Checks project-local override first, then built-in.
 * Returns the markdown content of the skill.
 */
export function loadSkill(skillName, kinetDir = null) {
  if (kinetDir) {
    const localPath = join(kinetDir, 'skills', `${skillName}.md`);
    if (existsSync(localPath)) return readFileSync(localPath, 'utf8');
  }
  const builtinPath = join(BUILTIN, `${skillName}.md`);
  if (existsSync(builtinPath)) return readFileSync(builtinPath, 'utf8');
  return null;
}

export const SKILLS = ['planning', 'architecture', 'security', 'testing'];
