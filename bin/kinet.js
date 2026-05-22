#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

program
  .name('kinet')
  .description('AI assistant bridge for React/Java repo ecosystems')
  .version(pkg.version);

// Lazy-load commands so startup is fast
program
  .command('init')
  .description('Initialise KINET in the current project')
  .option('-y, --yes', 'skip interactive prompts and use defaults')
  .option('--stack <stack>', 'primary stack: react|java|fullstack (default: auto-detect)')
  .action(async (opts) => {
    const { runInit } = await import('../src/cli/init.js');
    await runInit(opts);
  });

program
  .command('update')
  .description('Re-scan the project and refresh context, rules, and memories')
  .option('--context', 'refresh context distillation only')
  .option('--rules', 're-apply rules templates only')
  .option('--memory', 'rebuild memory index only')
  .action(async (opts) => {
    const { runUpdate } = await import('../src/cli/update.js');
    await runUpdate(opts);
  });

program
  .command('validate')
  .description('Validate project against KINET rules and report violations')
  .option('--fix', 'attempt auto-fix for safe violations')
  .option('--json', 'output results as JSON')
  .action(async (opts) => {
    const { runValidate } = await import('../src/cli/validate.js');
    await runValidate(opts);
  });

program
  .command('refresh')
  .description('Pull latest rule templates and skill definitions from KINET core')
  .action(async (opts) => {
    const { runRefresh } = await import('../src/cli/refresh.js');
    await runRefresh(opts);
  });

program
  .command('mcp')
  .description('Start the KINET MCP server (used by Claude Code automatically)')
  .option('--port <port>', 'HTTP port for SSE transport (omit for stdio)', parseInt)
  .action(async (opts) => {
    const { startMcpServer } = await import('../src/mcp/server.js');
    await startMcpServer(opts);
  });

program
  .command('status')
  .description('Show KINET installation status for the current project')
  .action(async () => {
    const { runStatus } = await import('../src/cli/status.js');
    await runStatus();
  });

program.parse();
