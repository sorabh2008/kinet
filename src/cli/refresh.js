import { join } from 'path';
import { existsSync, lstatSync, unlinkSync, readdirSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { KINET_DIR } from '../utils/paths.js';
import { loadConfig } from '../utils/config.js';
import { RulesEngine } from '../rules/engine.js';
import { installClaudeCommands } from '../commands/installer.js';

export async function runRefresh() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config) {
    console.error(chalk.red('KINET not initialised. Run `kinet init` first.'));
    process.exit(1);
  }

  const spinner = ora('Re-linking KINET templates...').start();

  try {
    const kinetDir = join(cwd, KINET_DIR);

    // Remove stale symlinks so install() can re-create them
    removeStaleSymlinks(join(kinetDir, 'rules'));
    removeStaleSymlinks(join(cwd, '.claude', 'commands'));

    const rules = new RulesEngine(kinetDir);
    await rules.install(config.stack, config.customRules ?? []);
    await installClaudeCommands(cwd, config.stack);

    spinner.succeed('Symlinks refreshed — all templates point to the current global install');
    console.log(chalk.dim('  Run `kinet update` to regenerate CLAUDE.md.\n'));
  } catch (err) {
    spinner.fail('Refresh failed');
    console.error(err.message);
    process.exit(1);
  }
}

function removeStaleSymlinks(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    // lstatSync succeeds even for broken symlinks; existsSync follows the link
    try { lstatSync(full); } catch { continue; }
    if (!existsSync(full)) unlinkSync(full);
  }
}
