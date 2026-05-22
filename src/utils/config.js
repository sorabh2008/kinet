import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { KINET_CONFIG_FILE } from './paths.js';

export function loadConfig(cwd) {
  const path = join(cwd, KINET_CONFIG_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
