APPROVED

# Review 2 — Architect stage (02-architecture.md)

## What I checked

- **`--port` is broken today: confirmed.** `SSEServerTransport.start()` sends the endpoint `/messages?sessionId=<uuid>` (sdk `dist/esm/server/sse.js:67-71`), but `src/mcp/server.js` matches `req.url === '/messages'` exactly, so every POST gets a 404. `Protocol.connect()` throws `Already connected to a transport` once `_transport` is set (`dist/esm/shared/protocol.js:216`), so the second `/sse` connection fails. D9 fixes both.
- **The commander design works: confirmed** with a throwaway script against the installed commander 13.1.0. With `enablePositionalOptions()` on both `program` and `mcp`, plus `allowExcessArguments()` and the `command.args` check:
  - `mcp` runs the parent with `{}`.
  - `mcp --port 9000` gives the parent `{port: 9000}`.
  - `mcp start --port 9001` gives `start` `{port: 9001}`.
  - `mcp foo` exits through `command.error`.
  - `mcp stop --port 1` is rejected as an unknown option.
  - Without positional options on `program`, `mcp start --port 9001` silently gives the port to the parent. So calling it on both is required, as D1 says.
- **SSE is deprecated but still present: confirmed.** The installed SDK is 1.29.0, and `SSEServerTransport` is marked `@deprecated` but still exported and working. D10 is reasonable.
- **Spawn and identity:** the detached spawn plus `unref`, the token passed in the environment, the `/health` check of token + pid + cwd, HTTP `/shutdown`, then SIGKILL after 5 s are all sound on macOS and Linux. Killing the process group with `process.kill(-pid)` is correct because `safeExec` spawns with `detached: true`, which makes the child a group leader.
- **AC coverage:** every AC in 01 has an architectural home. AC-0.7, AC-11.x and the exit codes are handed to the Solution Designer or Developer in §6.
- **Dependencies:** no new production dependency. `glob` is already a dependency, and Express is correctly avoided.
- **Irreversible/costly call:** I agree that nothing here is irreversible. The default port, the state location and staying on SSE are all cheap to change later.
- **CLAUDE.md:** no conflicts, apart from finding 3.

## Findings

1. **[non-blocking, must fix in 03] T3's `git grep -E "\b(TODO|FIXME|HACK|XXX)\b"` matches nothing on macOS.**
   - Tested with git 2.54 on darwin: the command exits 1 with no output on a file that contains `a TODO x`, so the tool would silently report zero TODOs. Git's `-E` uses the system POSIX regex, which does not support `\b`.
   - Fix: use `git grep -n -I --untracked -w -E "TODO|FIXME|HACK|XXX"`. `-w` is portable; I tested it and it correctly skips `myTODOs`. Avoid `-P`, because it depends on git being built with PCRE.
   - Also add the pathspec `:(exclude)node_modules`. `git grep` only skips `node_modules` when it is gitignored, but AC-3.3 requires it to be skipped unconditionally.
2. **[non-blocking, must fix in 03] D2: an interrupted `start` leaves the project stuck.**
   - Ctrl-C during the 4 s health poll kills the parent before `finally` runs. That leaves (a) `mcp.lock` in place, so every later `start` says "another start in progress", and (b) a running detached daemon with no state file, so `status` says stopped, `stop` says "not running", and the next `start` fails with "port in use". You cannot recover without deleting files and killing the process by hand.
   - Fix:
     - Write the parent PID into the lock, and treat the lock as stale if that PID is dead or the lock is older than about 10 s.
     - Install a SIGINT/SIGTERM handler for the duration of `start` that kills the child and removes the lock.
3. **[non-blocking] The `http.js` router needs a top-level try/catch.** CLAUDE.md rule `node/async-handlers-must-handle-errors` requires it, and today's `createServer(async (req, res) => …)` has none. On Node 20, a rejection from `handlePostMessage` or `/health` is an unhandled rejection, which crashes the daemon. Wrap the handler: log the message, respond 500 if headers have not been sent yet.
4. **[non-blocking] Leftover child processes and the token:**
   - `/shutdown` and SIGTERM should kill any in-flight `safeExec` process groups before exiting. SIGKILL on the daemon leaves them orphaned, because they are in their own groups.
   - `safeExec` should remove `KINET_MCP_TOKEN` from the environment it passes to `npm run`, so project scripts never see the token.
5. **[nit] Small details for the Solution Designer:**
   - `kinet mcp --port 9000 start` puts the port on the parent, and `start` silently uses 7345. Either fall back to `mcp.opts().port` or reject it.
   - T1 should run `git --no-optional-locks status`, so a read-only tool never takes `.git/index.lock` while the user is running git commands.
