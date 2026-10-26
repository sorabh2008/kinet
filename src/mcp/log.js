// Timestamped logger. It writes to stderr because in stdio mode stdout carries
// MCP protocol messages only, and in daemon mode stderr is the log file.

const DEFAULT_CAP_BYTES = 10 * 1024 * 1024;

export function createLogger({ stream = process.stderr, capBytes = DEFAULT_CAP_BYTES } = {}) {
  let written = 0;
  let capped = false;

  function write(level, message) {
    const line = `${new Date().toISOString()} ${level} ${message}\n`;
    stream.write(line);
    written += Buffer.byteLength(line);
  }

  // After the cap, routine lines are dropped so one long run cannot fill the disk;
  // warnings (including shutdown) and errors still get through.
  function routine(level, message) {
    if (capped) return;
    write(level, message);
    if (written >= capBytes) {
      capped = true;
      write('WARN', 'log cap reached; tool-call lines suppressed');
    }
  }

  return {
    info: (message) => routine('INFO', message),
    tool: (name, ms, ok) => routine('INFO', `tool name=${name} ms=${Math.round(ms)} result=${ok ? 'ok' : 'error'}`),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
  };
}
