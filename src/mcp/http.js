import { timingSafeEqual } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const DEFAULT_MAX_SESSIONS = 16;

// Exact Host match blocks DNS rebinding: a rebound page still sends its own hostname.
export function isAllowedHost(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

// Non-browser MCP clients send no Origin; browsers on other sites are refused.
export function isAllowedOrigin(origin, port) {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

// Browsers mark cross-site subresource requests (e.g. <img src=".../sse">), which
// carry no Origin; MCP clients send no Sec-Fetch-Site at all (06-security finding 4).
export function isAllowedFetchSite(secFetchSite) {
  return secFetchSite === undefined || secFetchSite === 'same-origin' || secFetchSite === 'none';
}

export function acceptsEventStream(accept) {
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

export function tokenMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' }).end(text);
}

export function createRequestHandler({ port, token, createSessionServer, log, healthInfo, requestShutdown, maxSessions = DEFAULT_MAX_SESSIONS }) {
  const sessions = new Map();

  async function openSession(res) {
    if (sessions.size >= maxSessions) return sendText(res, 503, 'Too many sessions');
    const transport = new SSEServerTransport('/messages', res);
    const shortId = transport.sessionId.slice(0, 8);
    sessions.set(transport.sessionId, transport);
    // Set before connect(): the SDK chains any existing onclose.
    transport.onclose = () => {
      if (sessions.delete(transport.sessionId)) log.info(`session close id=${shortId}`);
    };
    try {
      await createSessionServer().connect(transport);
    } catch (err) {
      sessions.delete(transport.sessionId);
      throw err;
    }
    log.info(`session open id=${shortId}`);
  }

  async function postMessage(req, res, url) {
    const transport = sessions.get(url.searchParams.get('sessionId'));
    if (!transport) return sendText(res, 404, 'Unknown session');
    await transport.handlePostMessage(req, res);
  }

  // /health and /shutdown exist only in daemon mode (a token was set at boot).
  function authorised(req, res) {
    if (!token) {
      res.writeHead(404).end();
      return false;
    }
    if (!tokenMatches(req.headers['x-kinet-token'], token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return false;
    }
    return true;
  }

  async function route(req, res, url) {
    if (!isAllowedHost(req.headers.host, port)) return sendText(res, 403, 'Forbidden host');
    if (!isAllowedOrigin(req.headers.origin, port)) return sendText(res, 403, 'Forbidden origin');
    if (!isAllowedFetchSite(req.headers['sec-fetch-site'])) return sendText(res, 403, 'Forbidden fetch site');

    const key = `${req.method} ${url.pathname}`;
    if (key === 'GET /sse') {
      if (!acceptsEventStream(req.headers.accept)) return sendText(res, 406, 'Accept must include text/event-stream');
      return openSession(res);
    }
    if (key === 'POST /messages') return postMessage(req, res, url);
    if (key === 'GET /health') {
      if (authorised(req, res)) sendJson(res, 200, { ...healthInfo(), sessions: sessions.size });
      return;
    }
    if (key === 'POST /shutdown') {
      if (!authorised(req, res)) return;
      sendJson(res, 202, { ok: true });
      setImmediate(() => requestShutdown('http'));
      return;
    }
    res.writeHead(404).end();
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      await route(req, res, url);
    } catch (err) {
      log.error(`http ${req.method} ${url.pathname}: ${err.message}`);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  }

  async function closeAllSessions() {
    await Promise.all([...sessions.values()].map((transport) => transport.close()));
  }

  return { handler, sessions, closeAllSessions };
}

// Binds to 127.0.0.1 only; the MCP routes have no auth of their own.
export function listenLocal(httpServer, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.off('error', onError);
      resolve(httpServer);
    });
  });
}
