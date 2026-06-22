import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { distillContext } from '../context/distiller.js';
import { RulesEngine } from '../rules/engine.js';
import { MemoryStore } from '../memory/store.js';
import { PrpSystem } from '../prp/system.js';
import { generateClaudeMd } from '../context/claude-md.js';
import { installClaudeCommands } from '../commands/installer.js';
import { KINET_DIR, KINET_CONFIG_FILE, templatePath } from '../utils/paths.js';

export async function runInit(opts) {
  const cwd = process.cwd();
  const kinetDir = join(cwd, KINET_DIR);

  console.log(chalk.cyan('\n  KINET — AI Assistant Bridge\n'));

  if (existsSync(join(cwd, KINET_CONFIG_FILE))) {
    console.log(chalk.yellow('  KINET already initialised. Run `kinet update` to refresh.'));
    process.exit(0);
  }

  // Gather project info
  let config = await gatherConfig(cwd, opts);

  const spinner = ora('Scanning project...').start();

  try {
    // 1. Create .kinet directory structure
    ensureDirs(kinetDir);
    spinner.text = 'Distilling context...';

    // 2. Distill context from the repo
    const context = await distillContext(cwd, config.stack);
    writeJson(join(kinetDir, 'context', 'distilled.json'), context);

    // 3. Install rules
    spinner.text = 'Installing rules...';
    const rules = new RulesEngine(kinetDir);
    await rules.install(config.stack, config.customRules);

    // 4. Initialise memory store
    spinner.text = 'Initialising memory...';
    const memory = new MemoryStore(kinetDir);
    await memory.init(context);

    // 5. Initialise PRP system
    spinner.text = 'Setting up PRP system...';
    const prp = new PrpSystem(kinetDir);
    await prp.init(config, context);

    // 6. Generate CLAUDE.md
    spinner.text = 'Generating CLAUDE.md...';
    const claudeMd = await generateClaudeMd(context, rules, config);
    writeFileSync(join(cwd, 'CLAUDE.md'), claudeMd);

    // 7. Install .claude/commands
    spinner.text = 'Installing Claude commands...';
    await installClaudeCommands(cwd, config.stack);

    // 8. Write MCP config to .claude/settings.json
    spinner.text = 'Configuring MCP server...';
    await configureMcp(cwd);

    // 9. Write kinet.config.json
    const finalConfig = { ...config, version: '1.0.0', initAt: new Date().toISOString() };
    writeJson(join(cwd, KINET_CONFIG_FILE), finalConfig);

    spinner.succeed(chalk.green('KINET initialised successfully!'));
    printSummary(cwd, config);

  } catch (err) {
    spinner.fail(chalk.red('Initialisation failed'));
    console.error(err.message);
    process.exit(1);
  }
}

async function gatherConfig(cwd, opts) {
  const detected = detectStack(cwd);

  if (opts.yes) {
    return {
      stack: opts.stack || detected,
      projectName: cwd.split('/').pop(),
      customRules: [],
      githubOrg: '',
    };
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: cwd.split('/').pop(),
    },
    {
      type: 'list',
      name: 'stack',
      message: 'Primary stack:',
      choices: ['react', 'node', 'java', 'python', 'salesforce', 'flutter', 'fullstack'],
      default: opts.stack || detected,
    },
    {
      type: 'input',
      name: 'githubOrg',
      message: 'GitHub org/owner (for PR and repo search):',
      default: '',
    },
    {
      type: 'checkbox',
      name: 'customRules',
      message: 'Enable optional rule sets:',
      choices: [
        { name: 'Accessibility (WCAG 2.1 AA)', value: 'a11y' },
        { name: 'Performance budgets', value: 'perf' },
        { name: 'API contract enforcement', value: 'api-contracts' },
        { name: 'Dependency version pinning', value: 'dep-pinning' },
      ],
    },
  ]);

  return answers;
}

function detectStack(cwd) {
  const hasPkg = existsSync(join(cwd, 'package.json'));
  const hasPom = existsSync(join(cwd, 'pom.xml')) || existsSync(join(cwd, 'build.gradle'));
  const hasSfdx = existsSync(join(cwd, 'sfdx-project.json'));
  const hasFlutter = existsSync(join(cwd, 'pubspec.yaml'));
  const hasPython = existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'pyproject.toml'))
    || existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'Pipfile'));

  if (hasSfdx) return 'salesforce';
  if (hasFlutter) return 'flutter';
  if (hasPkg && hasPom) return 'fullstack';
  if (hasPom) return 'java';
  if (hasPython) return 'python';

  if (hasPkg) {
    const pkg = readJsonSafe(join(cwd, 'package.json'));
    const hasReact = !!(pkg?.dependencies?.react || pkg?.devDependencies?.react);
    return hasReact ? 'react' : 'node';
  }

  return 'react';
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function ensureDirs(kinetDir) {
  for (const sub of ['context', 'rules', 'memory', 'prp', 'skills']) {
    mkdirSync(join(kinetDir, sub), { recursive: true });
  }
  mkdirSync(join(kinetDir, '..', '.claude', 'commands'), { recursive: true });
}

async function configureMcp(cwd) {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
  }

  settings.mcpServers = settings.mcpServers || {};
  settings.mcpServers.kinet = {
    command: 'kinet',
    args: ['mcp'],
    env: {},
  };

  writeJson(settingsPath, settings);
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function printSummary(cwd, config) {
  console.log(`
  ${chalk.bold('What was created:')}

  ${chalk.green('✓')} CLAUDE.md              — AI context file (commit this)
  ${chalk.green('✓')} .kinet/                — KINET data directory
  ${chalk.green('✓')} .kinet/context/        — Distilled project context
  ${chalk.green('✓')} .kinet/rules/          — Enforced coding rules
  ${chalk.green('✓')} .kinet/memory/         — Persistent AI memories
  ${chalk.green('✓')} .kinet/prp/            — Project Requirements & Patterns
  ${chalk.green('✓')} .claude/commands/      — AI slash commands (Plan/Commit/PR/Security)
  ${chalk.green('✓')} .claude/settings.json  — MCP server config

  ${chalk.bold('Available commands in Claude Code:')}

  ${chalk.cyan('/plan')}      Generate implementation plan aligned to your stack
  ${chalk.cyan('/commit')}    Validate + generate conventional commit message
  ${chalk.cyan('/pr-review')} Review current branch against KINET rules
  ${chalk.cyan('/security')}  Run security audit report

  ${chalk.bold('KINET CLI:')}

  ${chalk.cyan('kinet update')}    Refresh context after major changes
  ${chalk.cyan('kinet validate')}  Check codebase against rules
  ${chalk.cyan('kinet refresh')}   Pull latest KINET rule templates

  Stack: ${chalk.yellow(config.stack)}  |  Project: ${chalk.yellow(config.projectName)}
  `);
}
