import { join } from 'path';
import { existsSync, readdirSync, copyFileSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { KINET_DIR } from '../utils/paths.js';
import { loadConfig } from '../utils/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../../templates');

export async function runRefresh(opts) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config) {
    console.error(chalk.red('KINET not initialised. Run `kinet init` first.'));
    process.exit(1);
  }

  const spinner = ora('Refreshing KINET core templates...').start();

  try {
    const kinetDir = join(cwd, KINET_DIR);

    // Refresh rule templates
    const rulesTemplateSrc = join(TEMPLATES_DIR, 'rules');
    const rulesTemplateDst = join(kinetDir, 'rules');
    if (existsSync(rulesTemplateSrc)) {
      mkdirSync(rulesTemplateDst, { recursive: true });
      copyDir(rulesTemplateSrc, rulesTemplateDst, { overwriteCore: true });
    }

    // Refresh skills
    const skillsTemplateSrc = join(TEMPLATES_DIR, 'skills');
    const skillsTemplateDst = join(kinetDir, 'skills');
    if (existsSync(skillsTemplateSrc)) {
      mkdirSync(skillsTemplateDst, { recursive: true });
      copyDir(skillsTemplateSrc, skillsTemplateDst, { overwriteCore: true });
    }

    // Refresh Claude commands
    const commandsSrc = join(TEMPLATES_DIR, 'claude-commands');
    const commandsDst = join(cwd, '.claude', 'commands');
    if (existsSync(commandsSrc)) {
      mkdirSync(commandsDst, { recursive: true });
      copyDir(commandsSrc, commandsDst, { overwriteCore: true });
    }

    spinner.succeed('Core templates refreshed');
    console.log(chalk.dim('  Custom rules and PRP files were not overwritten.'));
    console.log(chalk.dim('  Run `kinet update` to regenerate CLAUDE.md.\n'));
  } catch (err) {
    spinner.fail('Refresh failed');
    console.error(err.message);
    process.exit(1);
  }
}

function copyDir(src, dst, opts = {}) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(dstPath, { recursive: true });
      copyDir(srcPath, dstPath, opts);
    } else {
      if (!existsSync(dstPath) || opts.overwriteCore) {
        copyFileSync(srcPath, dstPath);
      }
    }
  }
}
