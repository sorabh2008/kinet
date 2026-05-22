import { join } from 'path';
import { existsSync, writeFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { distillContext } from '../context/distiller.js';
import { RulesEngine } from '../rules/engine.js';
import { MemoryStore } from '../memory/store.js';
import { generateClaudeMd } from '../context/claude-md.js';
import { KINET_DIR, KINET_CONFIG_FILE } from '../utils/paths.js';
import { loadConfig } from '../utils/config.js';

export async function runUpdate(opts) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config) {
    console.error(chalk.red('KINET not initialised. Run `kinet init` first.'));
    process.exit(1);
  }

  const kinetDir = join(cwd, KINET_DIR);
  const all = !opts.context && !opts.rules && !opts.memory;

  console.log(chalk.cyan('\n  KINET update\n'));

  if (all || opts.context) {
    const spinner = ora('Distilling context...').start();
    const context = await distillContext(cwd, config.stack);
    writeJson(join(kinetDir, 'context', 'distilled.json'), context);

    const claudeMd = await generateClaudeMd(context, new RulesEngine(kinetDir), config);
    writeFileSync(join(cwd, 'CLAUDE.md'), claudeMd);
    spinner.succeed('Context refreshed → CLAUDE.md updated');
  }

  if (all || opts.rules) {
    const spinner = ora('Refreshing rules...').start();
    const rules = new RulesEngine(kinetDir);
    await rules.install(config.stack, config.customRules || []);
    spinner.succeed('Rules refreshed');
  }

  if (all || opts.memory) {
    const spinner = ora('Rebuilding memory index...').start();
    const memory = new MemoryStore(kinetDir);
    await memory.rebuild();
    spinner.succeed('Memory index rebuilt');
  }

  console.log(chalk.green('\n  Update complete.\n'));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}
