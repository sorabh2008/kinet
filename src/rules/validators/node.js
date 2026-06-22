// Node.js backend-specific rule validators (Express/Fastify/NestJS style servers)

import { readFileSync } from 'fs';
import { join } from 'path';

export const nodeValidators = [
  {
    id: 'node/no-require-in-esm',
    lang: 'js',
    check(content, file, { cwd }) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) return [];
      const pkg = readPkgSafe(cwd);
      if (pkg?.type !== 'module') return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\brequire\(\s*['"]/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'node/no-require-in-esm', severity: 'error', line: i + 1, message: 'CommonJS require() used in an ESM ("type": "module") package', suggestion: 'Use `import` syntax instead of `require()`' });
        }
      }
      return violations;
    },
  },
  {
    id: 'node/no-sync-fs-in-handler',
    lang: 'js',
    check(content, file) {
      if (!isHandlerFile(file)) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bfs\.(readFileSync|writeFileSync|appendFileSync|execSync)\(/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'node/no-sync-fs-in-handler', severity: 'error', line: i + 1, message: 'Synchronous, blocking call inside a request handler — blocks the event loop for all concurrent requests', suggestion: 'Use the async `fs/promises` API (or `util.promisify`) and `await` it' });
        }
      }
      return violations;
    },
  },
  {
    id: 'node/async-handler-error-handling',
    lang: 'js',
    check(content, file) {
      if (!isHandlerFile(file)) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/async\s*\(\s*(req|request)\s*,\s*(res|response)/.test(lines[i])) {
          const block = lines.slice(i, i + 20).join('\n');
          if (!/\btry\b/.test(block) && !/\.catch\(/.test(block)) {
            violations.push({ rule: 'node/async-handler-error-handling', severity: 'warning', line: i + 1, message: 'Async request handler has no try/catch or .catch() — a rejected promise will crash the process or hang the request', suggestion: 'Wrap the handler body in try/catch, or use an async-error-handling wrapper middleware' });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'node/no-db-calls-in-routes',
    lang: 'js',
    check(content, file) {
      if (!file.includes('/routes/') && !file.includes('/controllers/')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\b(knex|sequelize|mongoose\.\w+|prisma\.\w+)\s*[.(]/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'node/no-db-calls-in-routes', severity: 'warning', line: i + 1, message: 'Direct database call in a route/controller — move to a service or repository layer', suggestion: 'Extract data access into src/services/ or src/repositories/' });
        }
      }
      return violations;
    },
  },
];

function isHandlerFile(file) {
  return file.includes('/routes/') || file.includes('/controllers/') || file.includes('/handlers/');
}

function readPkgSafe(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}
