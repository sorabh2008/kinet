# 02 — Architecture: MCP lifecycle CLI + 5 solo-dev MCP tools

Stage: Architect | Branch: `feature/mcp-cli-and-tools` | Date: 2026-10-25
Inputs: `01-requirement.md` (approved), `review-1.md` (round 2 notes), repo `CLAUDE.md`, `bin/kinet.js`, `src/mcp/server.js`, `src/utils/{paths,config,gitignore}.js`, `src/cli/init.js:170-180`, installed `@modelcontextprotocol/sdk` 1.29.0, `commander` 13.1.0.

## No irreversible/costly decisions

No new vendor, no new production dependency, nothing paid, no data migration. Everything below is internal to the package and can be changed in a later release. The default port (D4) and the state-file location (D3) are documented behaviour but are cheap to change.

One item goes to Security for confirmation, not to Saurabh: D8 (Host/Origin check) answers the open question in 01 §8. I made it a decision because `kinet_run_script` makes the HTTP server able to run code.

## 0. Findings from the current code (they affect scope)

1. **`kinet mcp --port` does not work today.** The SSE transport tells the client to POST to `/messages?sessionId=<uuid>`, but `server.js` matches `req.url === '/messages'` exactly, so every POST gets a 404. Also, a second `/sse` connection calls `server.connect()` on the same `Server`, and SDK 1.29 throws `Already connected to a transport`. So AC-6.2 ("still works") really means "fix it". The fix is part of this work (see §3), not optional.
2. `SSEServerTransport` is marked `@deprecated` in SDK 1.29 ("Use StreamableHTTPServerTransport instead"). It is still exported and working. See D7.
3. The SDK's own `hostHeaderValidation` middleware is Express-shaped. Express is only a transitive dependency of the SDK, so we must not import it. We write our own Host/Origin check (about 15 lines).
4. `commander` 13 already rejects extra arguments by default (`_allowExcessArguments = false`), but its error does not name the valid subcommands (AC-6.6). We need a custom check.
5. `.kinet/` is gitignored only if `kinet init` has run (`src/utils/gitignore.js`). `kinet mcp start` must work without init (AC-0.2), so run files need their own gitignore (D3).
6. Existing `kinet_get_context` uses `readFileSync` inside a handler. This is out of scope (01 §9: don't change the 9 tools). New code must not copy that pattern.

## 1. Component view

```
bin/kinet.js
  └─ mcp  (command: options --port; action = foreground server)
       ├─ start [--port]   ─┐
       ├─ stop              ├─> src/cli/mcp.js        (lifecycle commands, CLI side only)
       ├─ status            │       └─ src/mcp/runstate.js  (state file, lock, health probe, identity check)
       └─ logs [-n] [-f]   ─┘
                                     spawn(detached) ──> node bin/kinet.js mcp --port N
                                                          env KINET_MCP_TOKEN=<random>
src/mcp/server.js
  ├─ createKinetServer()      new MCP Server with the 14 tools (one per session)
  ├─ startMcpServer({port})   stdio, or HTTP via http.js
  └─ dispatch()               9 existing cases + lookup in tools/local registry
src/mcp/http.js               node:http router: host/origin guard, /sse, /messages, /health, /shutdown
src/mcp/log.js                stderr logger with timestamps and a size cap
src/mcp/tools/
  ├─ web-search.js, github-search.js     (existing, unchanged)
  ├─ git-status.js   git-diff.js   find-todos.js   run-script.js   check-deps.js   (new)
  └─ local.js        registry: [gitStatus, gitDiff, findTodos, runScript, checkDeps]
src/utils/exec.js             safeExec(): async spawn, no shell, timeout, output cap, process-group kill
src/utils/args.js             assertNoLeadingDash(), resolveInsideProject()
src/rules/patterns.js         TICKET_REF regex fragment, used by validators/common.js and find-todos.js
```

## 2. Decisions

### D1. `kinet mcp` becomes a commander parent with 4 subcommands; bare and `--port` behave as today

- `mcp` keeps its own `.action()` and `--port` option. Bare `kinet mcp` runs stdio, and `kinet mcp --port N` runs HTTP in the foreground. `kinet init` keeps writing `args: ['mcp']` (AC-6.4).
- Subcommands `start`, `stop`, `status`, `logs` are added with `.command()` on the `mcp` command. Each one lazy-imports `src/cli/mcp.js`, following the pattern the other commands already use.
- Call `.enablePositionalOptions()` on `program` and on `mcp`, so `kinet mcp start --port 9000` gives the port to `start`, not to the parent.
- AC-6.6: call `.allowExcessArguments()` on `mcp`. In its action, if `command.args.length > 0`, call `command.error("unknown subcommand '<x>'. Valid: start, stop, status, logs")`. This exits non-zero and never starts a server.
- The port is parsed with a custom parser that accepts integers 1-65535 only. Passing a bare `parseInt` silently accepts `"80abc"`.
- The `mcp` description and `addHelpText('after', …)` explain that bare `kinet mcp` is the stdio mode Claude Code launches (AC-6.5).

### D2. Daemon: the parent spawns a detached child, checks its health, and only then writes state

`start` runs these steps:
1. Take a lock: create `.kinet/run/mcp.lock` with the `wx` flag. If it already exists, report "another start in progress" and exit 1. This stops two concurrent `start`s from racing. Remove the lock in `finally`.
2. If the state file exists and the identity check passes (D5), print the existing PID/port/URL and exit 0 (AC-7.4). If the state is stale, delete it.
3. Generate a token with `crypto.randomBytes(32).toString('hex')`.
4. Rotate the log (D6), then open the log file and get an fd.
5. `spawn(process.execPath, [<abs path to bin/kinet.js>, 'mcp', '--port', N], { cwd, detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, KINET_MCP_TOKEN: token } })`, then `child.unref()`.
   - Use `process.execPath` plus the absolute path to the bin, not `kinet` from PATH. The daemon is then the same version as the CLI that started it, and it also works under `npx`.
   - The token goes in the environment, not in argv, so it does not show up in `ps` output for other users.
6. Poll `GET /health` every 100 ms for up to 4 s, and also listen for the child's `exit` event. On success, write the state file atomically (write `mcp.json.tmp` with mode `0600`, then `rename`). Print PID, port, `http://127.0.0.1:<port>/sse` (review-1 note 1: not `localhost`) and the log path.
7. On failure (the child exited, e.g. `EADDRINUSE`, or the timeout passed), kill the child if it is still alive and print the last 20 log lines. Write no state, and exit 1 (AC-7.5).

The parent writes the state, not the child. That way state exists only for a server that has been verified as up, and a crashed child can never leave a half-written file.

### D3. Run files live in `<cwd>/.kinet/run/` and gitignore themselves

| File | Content |
|------|---------|
| `.kinet/run/.gitignore` | `*`. Written on first use, so run files are never committed even if `kinet init` never ran. |
| `.kinet/run/mcp.json` | `{ pid, port, token, cwd (realpath), startedAt, logPath, version }`, mode `0600` |
| `.kinet/run/mcp.log`, `mcp.log.1` | current log and the previous run's log |
| `.kinet/run/mcp.lock` | exists only while `start` is running |

The project is `process.cwd()`, the same as for every existing tool. We do not walk up to the git top level. This matches AC-0.2 and the requirement's per-project assumption.

### D4. Port: default 7345, no auto-pick

- The default is `7345`, documented in the README and `--help`. `start --port N` overrides it.
- If the port is busy, the child fails `listen` with `EADDRINUSE`, writes one clear line to the log and exits with code 3. The parent reports "port N is in use, try `kinet mcp start --port <other>`". We don't auto-pick a free port, because the client config needs a stable URL.
- If the busy port belongs to another project's KINET server, the health probe returns 401 because the token differs. We report that the port is in use and never treat it as ours.

### D5. Identity check: per-start token, verified through `/health`

The same check is used by `status` and before any signal in `stop` (AC-8.3, AC-9.3):
1. Read `mcp.json`. If it is missing, the server is `stopped`.
2. `process.kill(pid, 0)`. If it throws `ESRCH`, the process is gone: `stopped (stale)`, delete the state.
3. `GET http://127.0.0.1:<port>/health` with header `X-Kinet-Token: <token>`, 1 s timeout. The child compares the token in constant time (`crypto.timingSafeEqual`) with the `KINET_MCP_TOKEN` it read at boot. If it matches, it returns `{ pid, cwd, startedAt, version }`. Otherwise it returns 401.
4. The server counts as running only if the request returned 200 **and** `body.pid === state.pid` **and** `body.cwd === state.cwd`. Anything else means `stopped (stale)`: delete the state and never signal.

This is safe against PID reuse: a reused PID will not answer on our port with our token. It is also safe against port reuse: another process on the port does not know the token. It works the same on every OS, with no `ps` or `wmic` parsing.

`/health` and `/shutdown` are enabled only when `KINET_MCP_TOKEN` was set at boot. The foreground `--port` mode returns 404 for both. The env var is read and validated once in `startMcpServer` (it must be 64 hex characters, otherwise exit 1), following the rule `node/validate-environment-variables-at-startup`.

### D6. `stop` asks for a graceful shutdown over HTTP first, then force-kills

1. Run the identity check (D5). If it fails, print "not running", delete stale state and exit 0 (AC-9.2).
2. `POST /shutdown` with the token. The child replies 202, closes its SSE sessions and the HTTP server, logs `shutdown`, and exits 0.
3. Poll `process.kill(pid, 0)` for up to 5 s. If the process is still alive, call `process.kill(pid, 'SIGKILL')`. On Windows Node maps this to TerminateProcess. Identity was confirmed seconds earlier, so the chance of PID reuse in that window is negligible.
4. Delete `mcp.json` and print the PID. Logs are kept (AC-10.5).

The graceful path does not use signals, because SIGTERM handlers do not run on Windows. The child still handles `SIGTERM` and `SIGINT` (they call the same shutdown routine) for users who run `kill` or press Ctrl-C in foreground mode.

### D7. Logging: stderr is the log; rotate on start; cap the size during a run

- `src/mcp/log.js` writes `ISO-timestamp level message` lines to `process.stderr`. In stdio mode that goes to the client's stderr (AC-6.3: stdout is protocol only). In daemon mode stderr is the log file (D2 step 5), so crash stack traces land there too, with no extra code.
- It logs: start (port, cwd, version), each tool call (name, duration in ms, ok/error), errors (message only) and shutdown. It never logs argument values (AC-10.3).
- Rotation: on `start`, rename `mcp.log` to `mcp.log.1` (one previous run is kept, so you can still read a crash log after a restart), then open a new `mcp.log`.
- Cap: the logger counts bytes. Once a run passes 10 MB, it writes one line, `log cap reached; tool-call lines suppressed`, and from then on writes only errors and shutdown. Disk use is bounded at about 20 MB per project.
- `logs -n N`: read the file with `fs/promises` (at most about 10 MB) and print the last N lines. `logs -f`: print the tail, then use `fs.watchFile` (polling, works on every OS) and read from the last offset until SIGINT. This adds no dependency.

### D8. HTTP binding and the Host/Origin guard (answers 01 §8; Security to confirm)

- Both `--port` and `start` call `listen(port, '127.0.0.1')` (AC-6.2, AC-7.6).
- Every request first goes through `guard(req)`:
  - The `Host` header must be exactly `127.0.0.1:<port>` or `localhost:<port>`. Otherwise respond 403.
  - If an `Origin` header is present, it must be `http://127.0.0.1:<port>` or `http://localhost:<port>`. Otherwise respond 403. Non-browser MCP clients send no Origin and pass.
- Why this is a decision and not optional: with DNS rebinding, a web page could reach the local SSE server and call `kinet_run_script`. That would be code execution from a browser tab. The Host check alone blocks rebinding. The Origin check blocks cross-site requests from pages served on localhost.

### D9. SSE transport fixes (needed for D7/D8 to work at all)

- `createKinetServer()` builds a new `Server` with both handlers for each SSE session (the SDK allows one transport per `Server`).
- Sessions are kept in `Map<sessionId, transport>`. `GET /sse` creates a transport, stores it, and deletes it on `transport.onclose`.
- `POST /messages` is routed by `new URL(req.url, 'http://127.0.0.1').pathname`. The handler looks up `searchParams.get('sessionId')`; if it is unknown, it responds 404.
- At most 16 concurrent sessions are allowed; extra ones get 503. This bounds resources for a local tool.

### D10. Stay on SSE for v1; Streamable HTTP stays deferred

- SDK 1.29 marks `SSEServerTransport` deprecated, and the MCP spec replaced HTTP+SSE with Streamable HTTP in 2025-03-26. Claude Code and other major clients still connect to `type: "sse"` servers. Our `^1.12.0` range will not pull in a 2.x major that might remove SSE.
- Staying is not risky for v1. The router (D9) keeps transports behind path handlers, so adding `/mcp` with `StreamableHTTPServerTransport` later is an additive change that reuses `guard`, `createKinetServer` and `/health`.
- Trigger to revisit: the SDK 2.x upgrade, or a target client dropping SSE. Then do Later item 6 before any SDK major bump.

### D11. Tool modules and the shared safe-exec helper

Each new tool is its own module that exports `definition` (name, description, `inputSchema`) and `async run(args, ctx)`, where `ctx = { cwd, config, kinetDir, log }`. `tools/local.js` exports the array. In `server.js`, `TOOL_DEFINITIONS` becomes `[...existing9, ...local.map(t => t.definition)]`, and `dispatch` checks a `Map` from name to `run` before its existing `switch`. The 9 existing cases are not touched.

`src/utils/exec.js` contains `safeExec(cmd, args, { cwd, timeoutMs, maxChars = 20000, keep = 'head' | 'tail', env })`, which returns `{ code, signal, stdout, stderr, combined, timedOut, truncated, durationMs }`:
- It uses `child_process.spawn` with `shell: false`. It does not use `execFile`, because `maxBuffer` overflow kills the child, and we need to keep the tail and let the script finish.
- It collects output into capped buffers. `keep: 'tail'` keeps a rolling tail (for scripts); `'head'` keeps the start (for diffs). When truncated, it adds `[truncated: N more lines]` (AC-0.4).
- Timeout: on posix the child is spawned with `detached: true`, and the whole group is killed with `process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 2 s. `npm run` starts grandchildren, so killing only `npm` would leave the test runner alive. On Windows, `child.kill()` is best effort.
- It resolves on non-zero exit. A failing script is data (AC-4.5). It rejects only for spawn errors (`ENOENT` → "git/npm not found on PATH").
- There is no `*Sync` call anywhere in the new code (AC-0.9).

`src/utils/args.js`:
- `assertNoLeadingDash(value, name)` refuses values that start with `-` (AC-0.8a).
- `resolveInsideProject(cwd, p)` uses `path.resolve`. It refuses the path if `path.relative(cwd, abs)` starts with `..` or is absolute. If the path exists, it repeats the check on `fs.promises.realpath`, so a symlink cannot escape the project (AC-0.8c). It returns a path relative to `cwd`, and the caller always places it after `--` (AC-0.8b).

What each tool calls (all through `safeExec`):

| Tool | Commands | Notes |
|------|----------|-------|
| T1 git_status | `git rev-parse --is-inside-work-tree`, `git status --porcelain=v2 --branch`, `git log -n<k> --format=%h%x1f%an%x1f%aI%x1f%s` | porcelain v2 gives branch, upstream, ahead/behind and detached HEAD in one call. Read-only. |
| T2 git_diff | `git diff [--cached \| <ref>...HEAD] --stat -- [path]` then the same command without `--stat` | Unknown ref: run `git rev-parse --verify --quiet <ref>^{commit}` first. `keep: 'head'`. |
| T3 find_todos | git repo: `git grep -n -I --untracked -E "\b(TODO\|FIXME\|HACK\|XXX)\b" -- [path]`. Otherwise: `glob` (existing dep) + async read, skipping `node_modules`, `.git`, files over 1 MB and files with a NUL byte | `git grep` respects `.gitignore` and skips binary files (`-I`). `hasTicket` uses `TICKET_REF` from `src/rules/patterns.js`; `validators/common.js` is changed to build its regex from the same constant (review-1 note 2). |
| T4 run_script | `npm run <name>` | `name` must be a key of `package.json.scripts` (read with `fs/promises`). Env: `CI=true`, `NO_COLOR=1`, so test runners don't enter watch mode and hang. `keep: 'tail'`. One run at a time per server; a second call gets "a script is already running". |
| T5 check_deps | `npm outdated --json`, `npm audit --json`, run in parallel, 60 s timeout each | Both exit non-zero when they find something, which is expected. Parse the JSON and report a section error per command (AC-5.5). Neither command writes `package.json` or the lockfile. Note: `audit` sends the dependency tree to the npm registry, which is npm's own behaviour, not a new vendor. |

**Windows (v1 decision):** macOS and Linux are supported and tested. On Windows, the lifecycle commands and T1-T3 should work, because they rely only on HTTP shutdown, `process.kill` and `git.exe`. This is best effort, without CI. T4 and T5 return "not supported on Windows in v1": Node 20.12+ refuses to spawn `npm.cmd` without a shell (CVE-2024-27980 fix), and using a shell would break AC-0.5. This is consistent with 01 §9.

## 3. Alternatives considered

1. **Identity: check the process command line** (`ps -p <pid> -o command=`, `wmic`/PowerShell on Windows). Rejected: it is platform-specific, fragile, and `wmic` is gone on recent Windows.
2. **Identity: PID plus process start time.** Rejected: it also needs `ps`/proc parsing, and it does not catch port reuse.
3. **Stop via SIGTERM only.** Rejected: handlers do not run on Windows. HTTP `/shutdown` is portable and uses the same token.
4. **State in `~/.kinet/run/<hash-of-cwd>/`.** It would make `status --all` (Later item 4) easy, but it puts project state outside the project and makes log paths harder to find. Rejected for v1. This is reversible: a global index can be added later.
5. **Process manager (pm2, forever) or `tail` libraries.** Rejected: they are new production dependencies (AC-0.6).
6. **Streamable HTTP now.** Its cost is close to fixing SSE, but it changes the URL and client config that the requirement fixes as `/sse`. Deferred per D10.
7. **SDK `hostHeaderValidation` middleware.** Rejected: it needs Express, which is only a transitive dependency.
8. **`execFile` with `maxBuffer`.** Rejected: on overflow it kills the child and loses the tail of the output, which is where failures show.

## 4. Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | `--port` is broken today, so AC-6.2 is a fix, not a compat check | D9, plus a test that connects a real SSE client and calls `tools/list` |
| 2 | `kinet_run_script` can be reached over HTTP through DNS rebinding | D8 guard, 127.0.0.1 bind, tool description says it runs code (AC-4.6) |
| 3 | Test runners in watch mode hang | `CI=true`, timeout, process-group kill |
| 4 | SSE removed in a future SDK major | caret range pinned to 1.x; D10 trigger |
| 5 | Token readable by anyone who can read the project dir | file mode `0600`; local single-user tool; the token only allows health and shutdown |
| 6 | Flaky lifecycle tests (ports, timing) | tests get a free port with `net.listen(0)`, use a temp cwd, and poll instead of sleeping |
| 7 | Windows gaps | documented as best effort; T4/T5 refuse with a clear message |

## 5. ADR (inline; the repo has no `docs/decisions/` folder)

**ADR-001: Background MCP server lifecycle and local exec tools**
- Status: Accepted (Architect, 2026-10-25). D8 is pending Security confirmation.
- Context: 01-requirement US-5/US-6, AC-6 to AC-10, AC-0.5/0.8/0.9.
- Decision:
  - `kinet mcp` is a commander parent: bare runs stdio, `--port` runs HTTP in the foreground, and `start|stop|status|logs` manage one detached HTTP/SSE daemon per project directory.
  - Run state lives in `<cwd>/.kinet/run/`, which gitignores itself.
  - Identity is a per-start random token held by the daemon and checked through `GET /health` (PID, cwd and token must all match) before any status claim or signal. Graceful stop is token-authenticated `POST /shutdown`, then SIGKILL after 5 s.
  - The log is the daemon's stderr: rotated on start (one previous run kept) and capped at 10 MB per run.
  - The default port is 7345, bound to 127.0.0.1, with a strict Host/Origin guard.
  - Transport stays SSE (SDK 1.x) with one `Server` per session.
  - New tools run external commands only through `safeExec` (async spawn, no shell, timeout, capped output, process-group kill) with leading-dash refusal, project-confined paths and `--` separators.
  - v1 supports macOS and Linux; Windows is best effort, and the npm tools refuse on Windows.
- Consequences: no new dependencies. The `--port` mode becomes functional. Moving to Streamable HTTP later is an additive `/mcp` route. `status --all` will need a global index later.

## 6. Handoff notes for Solution Designer

1. Pin the exact `inputSchema` for T1-T5 and the output text format, including the "not a git repo" and "no package.json" messages.
2. Spell out the `TICKET_REF` extraction (review-1 note 2) and the regression test showing `kinet validate` output is unchanged.
3. Define the `/health` response shape and the exit codes for `start` (0 ok or already running, 1 failure) and `status` (0 running, 1 stopped).
4. Change the `npm test` glob to `node --test "src/**/*.test.js"` and add `eslint.config.js` (AC-11).
