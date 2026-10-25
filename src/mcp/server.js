import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { readFile, realpath } from 'node:fs/promises';
import { loadConfig } from '../utils/config.js';
import { KINET_DIR } from '../utils/paths.js';
import { capText, killActiveProcessGroups, OUTPUT_CAP } from '../utils/exec.js';
import { MemoryStore } from '../memory/store.js';
import { RulesEngine } from '../rules/engine.js';
import { PrpSystem } from '../prp/system.js';
import { loadSkill } from '../skills/index.js';
import { webSearch } from './tools/web-search.js';
import { githubSearch } from './tools/github-search.js';
import { localTools } from './tools/local.js';
import { createLogger } from './log.js';

const localByName = new Map(localTools.map((tool) => [tool.definition.name, tool.run]));

function toText(result) {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

export function createKinetServer({ log }) {
  const server = new Server(
    { name: 'kinet', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const kinetDir = config ? join(cwd, KINET_DIR) : null;
    const started = performance.now();

    // Only the tool name, duration and outcome are logged: argument values and
    // error texts can contain secrets.
    try {
      const localRun = localByName.get(name);
      const text = localRun
        ? capText(toText(await localRun(args ?? {}, { cwd, config, kinetDir, log })), OUTPUT_CAP)
        : toText(await dispatch(name, args, { cwd, config, kinetDir }));
      log.tool(name, performance.now() - started, true);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      log.tool(name, performance.now() - started, false);
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  return server;
}

// Read once at boot (rule: validate environment variables at startup) and removed
// from process.env so tools and their child processes never see it.
function takeDaemonToken() {
  const token = process.env.KINET_MCP_TOKEN;
  delete process.env.KINET_MCP_TOKEN;
  if (token === undefined) return { token: null };
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: 'KINET_MCP_TOKEN must be 64 hex characters' };
  return { token };
}

async function readVersion() {
  const pkgPath = new URL('../../package.json', import.meta.url);
  return JSON.parse(await readFile(pkgPath, 'utf8')).version;
}

export async function startMcpServer({ port } = {}) {
  const { token, error } = takeDaemonToken();
  if (error) {
    process.stderr.write(`Error: ${error}\n`);
    process.exitCode = 1;
    return;
  }

  const log = createLogger();
  const version = await readVersion();
  const mode = !port ? 'stdio' : token ? 'daemon' : 'http';
  const cwd = await realpath(process.cwd());
  log.info(`start mode=${mode} port=${port ?? '-'} pid=${process.pid} cwd=${cwd} version=${version}`);

  // Also covers stdio mode when the client goes away mid-script.
  process.on('exit', () => killActiveProcessGroups('SIGKILL'));

  let shuttingDown = false;
  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.warn(`shutdown reason=${reason}`);
    killActiveProcessGroups('SIGTERM');
    process.exit(0);
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  if (port) {
    // HTTP/SSE transport for remote use
    const server = createKinetServer({ log });
    const { createServer } = await import('http');
    let transport;
    const httpServer = createServer(async (req, res) => {
      if (req.url === '/sse') {
        transport = new SSEServerTransport('/messages', res);
        await server.connect(transport);
      } else if (req.url === '/messages' && req.method === 'POST') {
        await transport?.handlePostMessage(req, res);
      } else {
        res.writeHead(404).end();
      }
    });
    httpServer.listen(port, () => {
      log.info(`listening on port ${port}`);
    });
  } else {
    // Stdio transport (default — Claude Code uses this)
    const transport = new StdioServerTransport();
    await createKinetServer({ log }).connect(transport);
  }
}

async function dispatch(tool, args, ctx) {
  const { cwd, config, kinetDir } = ctx;

  switch (tool) {
    case 'kinet_web_search':
      return webSearch(args.query, args.maxResults);

    case 'kinet_github_search':
      return githubSearch(args.query, { org: config?.githubOrg, repo: args.repo, type: args.type });

    case 'kinet_get_context': {
      if (!kinetDir) return 'KINET not initialised in this project.';
      const path = join(kinetDir, 'context', 'distilled.json');
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : 'No context distilled yet.';
    }

    case 'kinet_get_rules': {
      if (!kinetDir) return 'KINET not initialised.';
      const rules = new RulesEngine(kinetDir);
      return rules.getSummary();
    }

    case 'kinet_get_prp': {
      if (!kinetDir) return 'KINET not initialised.';
      const prp = new PrpSystem(kinetDir);
      const section = args.section;
      const all = prp.getAll();
      return section ? (all[`${section}.md`] || `Section '${section}' not found`) : all;
    }

    case 'kinet_memory_recall': {
      if (!kinetDir) return 'KINET not initialised.';
      const store = new MemoryStore(kinetDir);
      return store.recall(args.query, { type: args.type, limit: args.limit || 10 });
    }

    case 'kinet_memory_save': {
      if (!kinetDir) return 'KINET not initialised.';
      const store = new MemoryStore(kinetDir);
      const id = store.save(
        args.id || `mem-${Date.now()}`,
        args.type || 'project',
        args.title,
        args.body,
      );
      return `Memory saved: ${id}`;
    }

    case 'kinet_get_skill': {
      const content = loadSkill(args.skill, kinetDir);
      return content || `Skill '${args.skill}' not found. Available: planning, architecture, security, testing`;
    }

    case 'kinet_validate': {
      if (!kinetDir) return 'KINET not initialised.';
      const rules = new RulesEngine(kinetDir);
      const report = await rules.validate(cwd);
      return report;
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

const CORE_TOOL_DEFINITIONS = [
  {
    name: 'kinet_web_search',
    description: 'Search the web for up-to-date documentation, CVEs, and library information',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return (default 5)', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'kinet_github_search',
    description: 'Search the GitHub organisation for existing patterns, issues, and PRs',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        repo: { type: 'string', description: 'Specific repo name to search within' },
        type: { type: 'string', enum: ['code', 'issues', 'prs', 'commits'], default: 'code' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kinet_get_context',
    description: 'Retrieve the distilled project context (tech stack, structure, patterns)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kinet_get_rules',
    description: 'Fetch the active KINET rule set',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kinet_get_prp',
    description: 'Retrieve Project Requirements & Patterns documents',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['requirements', 'patterns', 'decisions', 'context'], description: 'Specific section (omit for all)' },
      },
    },
  },
  {
    name: 'kinet_memory_recall',
    description: 'Recall project-specific AI memories by query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall' },
        type: { type: 'string', enum: ['project', 'feedback', 'user', 'reference'], description: 'Filter by memory type' },
        limit: { type: 'number', description: 'Max memories to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'kinet_memory_save',
    description: 'Persist a new memory for future AI sessions',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the memory' },
        body: { type: 'string', description: 'Memory content in markdown' },
        type: { type: 'string', enum: ['project', 'feedback', 'user', 'reference'], default: 'project' },
        id: { type: 'string', description: 'Optional stable ID (defaults to timestamp)' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'kinet_get_skill',
    description: 'Load a KINET skill definition for deep expertise in planning, architecture, security, or testing',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', enum: ['planning', 'architecture', 'security', 'testing'] },
      },
      required: ['skill'],
    },
  },
  {
    name: 'kinet_validate',
    description: 'Run KINET rule validation against the current project and return the report',
    inputSchema: { type: 'object', properties: {} },
  },
];

export const TOOL_DEFINITIONS = [...CORE_TOOL_DEFINITIONS, ...localTools.map((tool) => tool.definition)];
