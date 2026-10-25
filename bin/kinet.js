#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parsePort } from '../src/utils/args.js';
import { DEFAULT_PORT } from '../src/mcp/runstate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

program
  .name('kinet')
  .enablePositionalOptions()
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

const mcp = program
  .command('mcp')
  .description('Run the KINET MCP server. Bare `kinet mcp` is the stdio mode Claude Code launches.')
  .enablePositionalOptions()
  .allowExcessArguments()
  .option('--port <port>', 'run the HTTP/SSE server in the foreground on 127.0.0.1:<port>', parsePort)
  .addHelpText('after', `
Background server (one per project directory, bound to 127.0.0.1):
  kinet mcp start [--port <n>]      start it (default port ${DEFAULT_PORT})
  kinet mcp status                  show whether it is running
  kinet mcp stop                    stop it
  kinet mcp logs [-n <lines>] [-f]  show or follow its log

Bare \`kinet mcp\` (no subcommand) runs the stdio server used by Claude Code; your .claude/settings.json does not need to change.`)
  .action(async (opts, command) => {
    if (command.args.length) {
      const valid = command.commands.map((sub) => sub.name()).join(', ');
      command.error(`error: unknown subcommand '${command.args[0]}'. Valid: ${valid}`);
    }
    const { startMcpServer } = await import('../src/mcp/server.js');
    await startMcpServer(opts);
  });

// The parent --port only means something for `start`; refuse it elsewhere so
// nobody thinks they are targeting a specific server.
function rejectParentPort(command) {
  if (command.parent.opts().port !== undefined) {
    command.error("error: --port only applies to 'kinet mcp start' and foreground 'kinet mcp --port <n>'");
  }
}

mcp
  .command('start')
  .description(`start the background HTTP/SSE server for this project (default port ${DEFAULT_PORT})`)
  .option('--port <port>', 'port to listen on (127.0.0.1 only)', parsePort)
  .action(async (opts, command) => {
    const { runMcpStart } = await import('../src/cli/mcp.js');
    await runMcpStart({ port: opts.port ?? command.parent.opts().port ?? DEFAULT_PORT });
  });

mcp
  .command('status')
  .description('show whether the background server is running (exit 0 running, 1 stopped)')
  .action(async (opts, command) => {
    rejectParentPort(command);
    const { runMcpStatus } = await import('../src/cli/mcp.js');
    await runMcpStatus();
  });

program
  .command('status')
  .description('Show KINET installation status for the current project')
  .action(async () => {
    const { runStatus } = await import('../src/cli/status.js');
    await runStatus();
  });

program.parse();
