import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createRequestHandler, isAllowedHost, isAllowedOrigin, isAllowedFetchSite, acceptsEventStream, tokenMatches, listenLocal } from './http.js';
import { freePort } from '../test-support/helpers.js';

const TOKEN = 'a'.repeat(64);

function memoryLog() {
  const lines = [];
  const add = (level) => (msg) => lines.push(`${level} ${msg}`);
  return { lines, info: add('INFO'), warn: add('WARN'), error: add('ERROR'), tool() {} };
}

async function startServer(options) {
  const port = await freePort();
  const log = memoryLog();
  const shutdowns = [];
  const { handler } = createRequestHandler({
    port,
    log,
    createSessionServer: () => { throw new Error('no session server'); },
    healthInfo: () => ({ pid: 123, cwd: '/x', startedAt: 'now', version: '1.0.1' }),
    requestShutdown: (reason) => shutdowns.push(reason),
    ...options(port),
  });
  const server = await listenLocal(createServer(handler), port);
  return { port, log, shutdowns, server };
}

function send(port, { method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (d) => { body += d; }).on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.once('error', reject);
    req.end();
  });
}

test('host and origin allowlists', () => {
  assert.equal(isAllowedHost('127.0.0.1:7345', 7345), true);
  assert.equal(isAllowedHost('localhost:7345', 7345), true);
  assert.equal(isAllowedHost('evil.example:7345', 7345), false);
  assert.equal(isAllowedHost('127.0.0.1:1', 7345), false);
  assert.equal(isAllowedHost(undefined, 7345), false);
  assert.equal(isAllowedOrigin(undefined, 7345), true);
  assert.equal(isAllowedOrigin('http://localhost:7345', 7345), true);
  assert.equal(isAllowedOrigin('http://evil.example', 7345), false);
});

test('tokenMatches refuses wrong, missing and different-length tokens', () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches('b'.repeat(64), TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
  assert.equal(tokenMatches('a', TOKEN), false);
  assert.equal(tokenMatches(TOKEN, null), false);
});

test('binds to 127.0.0.1 only (AC-7.6, AC-6.2)', async () => {
  const { server } = await startServer(() => ({ token: null }));
  assert.equal(server.address().address, '127.0.0.1');
  server.close();
});

test('a failing route answers 500 and logs instead of crashing (review-2 finding 3)', async () => {
  const { port, log, server } = await startServer(() => ({ token: null }));
  const res = await send(port, { path: '/sse', headers: { accept: 'text/event-stream' } });
  assert.equal(res.status, 500);
  assert.ok(log.lines.some((l) => l.startsWith('ERROR http GET /sse: no session server')));
  server.close();
});

test('guard refuses foreign Host and Origin headers (D8)', async () => {
  const { port, server } = await startServer(() => ({ token: null }));
  assert.equal((await send(port, { path: '/sse', headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await send(port, { path: '/sse', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await send(port, { method: 'POST', path: '/messages?sessionId=nope' })).status, 404);
  server.close();
});

test('/health and /shutdown are 404 without a daemon token', async () => {
  const { port, server } = await startServer(() => ({ token: null }));
  assert.equal((await send(port, { path: '/health' })).status, 404);
  assert.equal((await send(port, { method: 'POST', path: '/shutdown' })).status, 404);
  server.close();
});

test('/health and /shutdown need the token in daemon mode', async () => {
  const { port, shutdowns, server } = await startServer(() => ({ token: TOKEN }));
  assert.equal((await send(port, { path: '/health', headers: { 'x-kinet-token': 'b'.repeat(64) } })).status, 401);
  const health = await send(port, { path: '/health', headers: { 'x-kinet-token': TOKEN } });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { pid: 123, cwd: '/x', startedAt: 'now', version: '1.0.1', sessions: 0 });

  assert.equal((await send(port, { method: 'POST', path: '/shutdown' })).status, 401);
  assert.equal((await send(port, { method: 'POST', path: '/shutdown', headers: { 'x-kinet-token': TOKEN } })).status, 202);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(shutdowns, ['http']);
  server.close();
});

test('/sse refuses browser subresource requests that cannot be MCP clients (06-security finding 4)', async () => {
  assert.equal(isAllowedFetchSite(undefined), true);
  assert.equal(isAllowedFetchSite('none'), true);
  assert.equal(isAllowedFetchSite('cross-site'), false);
  assert.equal(acceptsEventStream('text/event-stream'), true);
  assert.equal(acceptsEventStream('image/avif,image/webp,*/*'), false);

  const { port, log, server } = await startServer(() => ({ token: null }));
  const imgLike = await send(port, { path: '/sse', headers: { accept: 'image/avif,image/webp,*/*', 'sec-fetch-site': 'cross-site' } });
  assert.equal(imgLike.status, 403);
  assert.equal((await send(port, { path: '/sse', headers: { accept: 'image/webp,*/*' } })).status, 406);
  assert.equal((await send(port, { path: '/sse', headers: { accept: 'text/event-stream', 'sec-fetch-site': 'same-site' } })).status, 403);
  // Only a real event-stream request reaches session creation (which fails in this stub).
  assert.equal(log.lines.filter((l) => l.startsWith('ERROR http GET /sse')).length, 0);
  server.close();
});
