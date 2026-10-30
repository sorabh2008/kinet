import { join } from 'path';
import { writeFileSync, readFileSync } from 'fs';
import chalk from 'chalk';
import { RulesEngine } from '../rules/engine.js';
import { generateClaudeMd } from '../context/claude-md.js';
import { KINET_DIR, KINET_CONFIG_FILE } from '../utils/paths.js';
import { loadConfig } from '../utils/config.js';
import { normalizeLearning, parseTurns } from '../learning/settings.js';

const SWITCHES = ['on', 'off'];

/**
 * `kinet learning`                  show the current settings
 * `kinet learning retro on|off`
 * `kinet learning feedback off`
 * `kinet learning feedback on [turns]`   turns defaults to the last value, else 3
 */
export async function runLearning(target, value, turns) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  if (!config) {
    console.error(chalk.red('KINET not initialised. Run `kinet init` first.'));
    process.exit(1);
  }

  const learning = normalizeLearning(config.learning);

  if (target) {
    try {
      applyChange(learning, target, value, turns);
    } catch (err) {
      console.error(chalk.red(`  ${err.message}`));
      process.exit(1);
    }
    config.learning = learning;
    writeFileSync(join(cwd, KINET_CONFIG_FILE), JSON.stringify(config, null, 2));
    await regenerateClaudeMd(cwd, config);
    console.log(chalk.green('\n  Learning settings saved → CLAUDE.md updated'));
  }

  printLearning(learning);
}

function applyChange(learning, target, value, turns) {
  if (!['retro', 'feedback'].includes(target)) throw new Error(`unknown setting '${target}'. Use: retro, feedback`);
  if (!SWITCHES.includes(value)) throw new Error(`usage: kinet learning ${target} on|off`);
  const on = value === 'on';

  if (target === 'retro') {
    learning.retro = on;
    return;
  }
  if (!on) {
    learning.feedback = { enabled: false, turns: 0 };
    return;
  }
  learning.feedback = { enabled: true, turns: turns !== undefined ? parseTurns(turns) : learning.feedback.turns || 3 };
}

async function regenerateClaudeMd(cwd, config) {
  const kinetDir = join(cwd, KINET_DIR);
  const context = JSON.parse(readFileSync(join(kinetDir, 'context', 'distilled.json'), 'utf8'));
  writeFileSync(join(cwd, 'CLAUDE.md'), await generateClaudeMd(context, new RulesEngine(kinetDir), config));
}

function printLearning({ retro, feedback }) {
  const state = (on) => (on ? chalk.green('on') : chalk.dim('off'));
  console.log(chalk.cyan('\n  KINET learning\n'));
  console.log(`  Retro after each action:  ${state(retro)}`);
  console.log(`  Feedback each session:    ${state(feedback.enabled)}${feedback.enabled ? chalk.dim(` (first ${feedback.turns} turn${feedback.turns === 1 ? '' : 's'})`) : ''}\n`);
}
