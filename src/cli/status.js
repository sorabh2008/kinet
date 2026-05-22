import { join, relative } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import { KINET_DIR, KINET_CONFIG_FILE } from '../utils/paths.js';
import { loadConfig } from '../utils/config.js';

export async function runStatus() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  console.log(chalk.cyan('\n  KINET Status\n'));

  if (!config) {
    console.log(`  ${chalk.red('✗')} Not initialised — run ${chalk.cyan('kinet init')}`);
    return;
  }

  const checks = [
    { label: 'kinet.config.json',   path: KINET_CONFIG_FILE },
    { label: 'CLAUDE.md',           path: 'CLAUDE.md' },
    { label: '.kinet/context/',     path: join(KINET_DIR, 'context', 'distilled.json') },
    { label: '.kinet/rules/',       path: join(KINET_DIR, 'rules') },
    { label: '.kinet/memory/',      path: join(KINET_DIR, 'memory', 'index.json') },
    { label: '.kinet/prp/',         path: join(KINET_DIR, 'prp') },
    { label: '.claude/commands/',   path: join('.claude', 'commands') },
    { label: '.claude/settings.json', path: join('.claude', 'settings.json') },
  ];

  for (const { label, path } of checks) {
    const full = join(cwd, path);
    const ok = existsSync(full);
    const mtime = ok ? ` ${chalk.dim(relativeTime(statSync(full).mtime))}` : '';
    console.log(`  ${ok ? chalk.green('✓') : chalk.red('✗')}  ${label.padEnd(26)}${mtime}`);
  }

  console.log(`
  Project:  ${chalk.yellow(config.projectName)}
  Stack:    ${chalk.yellow(config.stack)}
  Initialised: ${chalk.dim(new Date(config.initAt).toLocaleDateString())}
  KINET version: ${chalk.dim(config.version)}
  `);
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
