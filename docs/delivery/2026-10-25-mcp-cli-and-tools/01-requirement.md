# 01 — Requirement: MCP lifecycle CLI + 5 solo-dev MCP tools

Stage: Product Owner | Branch: `feature/mcp-cli-and-tools` | Date: 2026-10-25

Original ask (verbatim): "suggest and add top 5 mcp tools useful for solo dev. make mcp cli to have start and status and stop and logs arcguments make it like kinet mcp {agument}"

## 1. Problem / goal

1. KINET's MCP server tells the AI about rules, context and memory, but not about the live state of the repo: what changed, what is uncommitted, what is left to do, whether tests pass, whether dependencies are stale. A solo developer has to paste this in by hand.
2. `kinet mcp` can only run in the foreground. There is no way to run the HTTP server in the background and then check on it, read its logs, or stop it.

Goal: add 5 read-mostly, project-aware tools that need no new vendor or production dependency, and add `kinet mcp start|stop|status|logs` without breaking the bare `kinet mcp` that every existing install relies on.

## 2. The 5 tools (picked) and why

| # | Tool | Why a solo dev needs it |
|---|------|-------------------------|
| T1 | `kinet_git_status` | Lets the AI see the branch, uncommitted work and recent commits before it plans or commits. Supports the branch discipline in ways-of-working. |
| T2 | `kinet_git_diff` | Lets the AI review or summarise changes (`/pr-review`, `/commit`) without shell access. |
| T3 | `kinet_find_todos` | Lists TODO/FIXME/HACK/XXX markers and flags the ones missing a ticket reference. Backs the existing `common/no-todo-without-ticket` rule. |
| T4 | `kinet_run_script` | Runs a script defined in `package.json` (test, lint, build) and returns the result. This closes the loop: "did my change pass?" |
| T5 | `kinet_check_deps` | Reports outdated packages and known vulnerabilities by running npm's built-in `outdated`/`audit`. Pairs with the existing CVE web search. |

Runners-up rejected for v1 (deferred to the Later bucket, section 6):
1. `kinet_changelog`: drafts release notes from Conventional Commits. Useful, but T1/T2 already give the AI the raw material.
2. `kinet_env_check`: compares `.env.example` keys with `.env`. Small value, and it reads secret-bearing files, so it needs its own Security review.
3. `kinet_project_tree`: overlaps `kinet_get_context`.
4. `kinet_open_issues`: overlaps `kinet_github_search` (type=issues).
5. `kinet_http_request` / `kinet_db_query`: high risk (SSRF, data access, production data). Will not do.
6. Maven/Gradle support for T4/T5: deferred. v1 is npm only.

## 3. User stories

- US-1: As a solo dev using Claude Code, I want the AI to see my git state and diff, so that it plans and writes commit messages against what actually changed.
- US-2: As a solo dev, I want the AI to list my open TODOs and flag the ones with no ticket, so that I can tidy up before a PR.
- US-3: As a solo dev, I want the AI to run my project's test/lint/build scripts and read the result, so that it can check its own work.
- US-4: As a solo dev, I want the AI to tell me which dependencies are outdated or vulnerable, so that I can decide what to upgrade.
- US-5: As a solo dev, I want `kinet mcp start|stop|status|logs`, so that I can run the HTTP MCP server in the background and manage it like a service.
- US-6: As an existing KINET user, I want my current `.claude/settings.json` (`kinet mcp`) to keep working with no changes.

## 4. Acceptance criteria

General rules for all 5 new tools (apply to every tool AC below):
- AC-0.1: The tool appears in the MCP `tools/list` response with a name, description and JSON `inputSchema`. The 9 existing tools are still listed, unchanged.
- AC-0.2: The tool works on the server's project directory (cwd), the same way existing tools do. It works even when KINET is not initialised in that directory (it does not need `.kinet/`).
- AC-0.3: When cwd is not a git repo (T1, T2) or has no `package.json` (T4, T5), the tool returns a clear plain-English message. It does not throw an unhandled error or crash the server.
- AC-0.4: The tool's output is capped (default 20,000 characters, or less). When output is truncated, it says so explicitly (e.g. `[truncated: N more lines]`).
- AC-0.5: External commands are run without a shell, with the arguments passed as an array, so tool arguments cannot inject shell commands. For example, `ref: "main; rm -rf ~"` is rejected or treated as a literal ref name. It is never executed.
- AC-0.6: No new production dependency is added to `package.json`.
- AC-0.7: The README "MCP Tools" table lists all 14 tools.
- AC-0.8 (argument hardening): Applies to T2 `ref` and to `path` in T2/T3. (a) Values that start with `-` are refused with a clear message. Test: `ref: "--output=/tmp/x"` is refused and no file is written. (b) Paths are passed to git after a `--` separator. Test: `path: "src"` produces a command whose args contain `--` before `src`. (c) A `path` must resolve inside the project directory, otherwise the call is refused. Test: `path: "../.."` and `path: "/etc"` are both refused.
- AC-0.9: Tool commands run asynchronously. No `*Sync` child-process calls (`execSync`, `spawnSync`, `execFileSync`) are used in the new tool code, so the server keeps answering other requests while a tool runs (per rule `node/no-synchronous-blocking-calls-in-request-handlers`).

### T1 `kinet_git_status`
- AC-1.1: Returns the current branch name, the upstream (if any) with ahead/behind counts, and lists of staged, unstaged and untracked files.
- AC-1.2: Accepts optional `commits` (default 10, max 50) and returns that many most-recent commits with short hash, author, relative or ISO date, and subject.
- AC-1.3: A detached HEAD is reported as such (not as an error).
- AC-1.4: The tool is read-only. Running it leaves `git status --porcelain` output and HEAD unchanged.

### T2 `kinet_git_diff`
- AC-2.1: Accepts `scope`: `working` (unstaged, default), `staged`, or `ref`. With `ref`, it also takes a required `ref` string (e.g. `main`) and diffs `ref...HEAD`.
- AC-2.2: Returns a per-file stat summary (files changed, insertions, deletions) followed by the patch text, subject to AC-0.4.
- AC-2.3: Accepts optional `path` to limit the diff to one file or directory.
- AC-2.4: An unknown ref returns a clear message naming the ref. It does not return a stack trace.
- AC-2.5: No changes returns an explicit "no changes" message, not empty text.

### T3 `kinet_find_todos`
- AC-3.1: Finds `TODO`, `FIXME`, `HACK` and `XXX` markers and returns, for each one: file path (relative), line number, marker and line text.
- AC-3.2: Each result has `hasTicket: true|false`. It must reuse the exact ticket pattern from `src/rules/validators/common.js:47` (`/TODO(?!\s*\[#?\w+[-_]\d+\])/i`, applied to every marker). Share the pattern; do not copy it. So `kinet_find_todos` and `kinet validate` always agree (e.g. `TODO [PROJ-123]` → true, `TODO fix this` → false).
- AC-3.3: Skips `node_modules/`, `.git/`, and files ignored by `.gitignore` (in a git repo). Skips binary files.
- AC-3.4: Accepts optional `path` (subdirectory) and `missingTicketOnly` (boolean). Returns a total count and a count with no ticket.

### T4 `kinet_run_script`
- AC-4.1: Called with no `script`, it returns the list of script names and commands from `package.json` and runs nothing.
- AC-4.2: Called with `script: "<name>"`, it runs only if `<name>` is a key in `package.json` `scripts`. Any other name is refused with the list of valid names. Arbitrary commands cannot be run.
- AC-4.3: Returns the exit code, duration, and combined stdout/stderr (subject to AC-0.4, keeping the tail of the output, which is where failures show).
- AC-4.4: Has a timeout (default 120 s, optional `timeoutSeconds` up to 600). On timeout the process is killed and the result says it timed out.
- AC-4.5: A failing script (non-zero exit) is a normal result showing the exit code, not an MCP error. The server keeps running.
- AC-4.6: The tool description states that it executes project code, so the MCP client's approval prompt is meaningful.

### T5 `kinet_check_deps`
- AC-5.1: Returns outdated packages with name, current, wanted, latest, and dependency type (prod/dev).
- AC-5.2: Returns a vulnerability summary (counts by severity) and the affected package names.
- AC-5.3: Accepts `check`: `outdated`, `audit`, or `all` (default `all`).
- AC-5.4: Read-only: `package.json` and lockfiles are byte-identical before and after.
- AC-5.5: If the registry is unreachable or there is no lockfile, it returns a clear message for that part and still returns any part that worked.

### `kinet mcp` CLI

- AC-6.1 (backward compat): Bare `kinet mcp` still starts the stdio server in the foreground, exactly as today. An MCP client configured with `{ command: 'kinet', args: ['mcp'] }` can `initialize` and `tools/list` successfully.
- AC-6.2 (compat, with one deliberate change): `kinet mcp --port <n>` still runs the HTTP/SSE server in the foreground. It now binds to `127.0.0.1` only (previously all interfaces). This behaviour change is called out in the README. A `--host` option is deferred.
- AC-6.3: In stdio mode nothing except MCP protocol messages is written to stdout. All logs/diagnostics go to stderr.
- AC-6.4: `kinet init` still writes `args: ['mcp']`. Existing `.claude/settings.json` files need no changes.
- AC-6.5: `kinet mcp --help` lists `start`, `stop`, `status`, `logs`, and explains that bare `kinet mcp` is the stdio mode used by Claude Code.
- AC-6.6: `kinet mcp <unknown>` exits non-zero with an error naming the valid subcommands. It does not silently start a server.

#### `kinet mcp start [--port <n>]`
- AC-7.1: Starts the HTTP/SSE server as a detached background process and returns control to the terminal within 5 s. The process keeps running after the terminal closes.
- AC-7.2: Uses `--port` if given, otherwise a documented default port. It prints the PID, port, SSE URL (`http://localhost:<port>/sse`) and log file path.
- AC-7.3: The server serves the project directory that `start` was run from. Run state (PID, port, start time, log path) is recorded per project and is not committed to git.
- AC-7.4: If a server is already running for this project, it prints the existing PID/port, exits 0, and does not start a second one.
- AC-7.5: If the port is in use, or the server fails to come up, it exits non-zero with a clear message and leaves no stale run state behind.
- AC-7.6: The background server binds to `127.0.0.1` only. Test: after `start`, a connection to `127.0.0.1:<port>` succeeds, and the listening socket's address is `127.0.0.1`, not `0.0.0.0` or `::`.

#### `kinet mcp status`
- AC-8.1: When running, it prints `running` with PID, port, URL, uptime and log path, and exits 0.
- AC-8.2: When not running, it prints `stopped` and exits non-zero (so scripts can test it).
- AC-8.3: Liveness means confirming the process is really this project's KINET MCP server, not just that the PID is alive (PIDs are reused after a reboot). Architect picks the mechanism. If run state exists but the server is gone or the PID now belongs to another process, it reports `stopped (stale)` and clears the stale state.
- AC-8.4: It never starts or stops anything.

#### `kinet mcp stop`
- AC-9.1: Stops the background server for this project gracefully, then force-kills it if it is still alive after 5 s. It confirms with the PID and clears run state. After this, `status` reports `stopped`.
- AC-9.2: When nothing is running (or the state is stale), it prints "not running", clears any stale state, and exits 0.
- AC-9.3: It only signals the process after confirming, using the same check as AC-8.3, that it is this project's KINET MCP server. It never kills an unrelated process, even if that process reuses the PID or the port.

#### `kinet mcp logs [-n <lines>] [-f]`
- AC-10.1: Prints the last 50 lines (or `-n`) of the background server's log file.
- AC-10.2: `-f`/`--follow` streams new lines until Ctrl-C.
- AC-10.3: The log records at least: start (port, cwd), each tool call (tool name, duration, ok/error; no argument values that could hold secrets), errors, and shutdown.
- AC-10.4: With no log file yet, it prints a clear "no logs — has `kinet mcp start` been run?" message and exits non-zero.
- AC-10.5: Logs survive `stop`, so you can inspect them after a crash. The log does not grow without limit: it is truncated or rotated on each `start`, or capped at a size.

### Quality
- AC-11.1: `npm test` passes, and its output shows a non-zero test count (`# tests N`, N > 0). The `test` script quotes its glob (e.g. `node --test "src/**/*.test.js"`), so Node expands it rather than the shell, which would silently match nothing. The tests include `node:test` tests for: each of the 5 tools (happy path + one failure/edge path each, using a temp git repo/fixture), subcommand routing (bare/`--port`/`start`/`stop`/`status`/`logs`/unknown), and the start → status → stop → status lifecycle.
- AC-11.2: The repo gets a minimal ESLint flat config (`eslint.config.js`; none exists today, so lint cannot run). `npm run lint` passes. `kinet validate` reports no new violations.
- AC-11.3: The README CLI section documents `kinet mcp start|stop|status|logs` and the change of `--port` to localhost-only binding.

## 5. v1 scope

In: the 5 tools above (npm/git only); `kinet mcp start|stop|status|logs` for one background HTTP server per project; unchanged bare `kinet mcp`; `kinet mcp --port` restricted to localhost; minimal eslint config and a quoted test glob; tests; README.

## 6. Deferred (Later bucket)

1. Maven/Gradle support for `kinet_run_script` and `kinet_check_deps` (Java stack parity).
2. `kinet_changelog`, `kinet_env_check` (env_check needs a Security pass first).
3. `kinet mcp restart`.
4. Listing or stopping servers across all projects (`kinet mcp status --all`).
5. Auto-start on login (launchd/systemd).
6. Streamable HTTP transport (the newer MCP transport replacing SSE).
7. Auth on the HTTP server, and a `--host` option for non-localhost binding.
8. A `kinet init` option to configure clients to use the background HTTP server instead of stdio.

## 7. Assumptions (correct any of these if wrong)

- [ASSUMPTION, to confirm with Saurabh at close-out] "Add top 5 MCP tools" means 5 new tools in KINET's own MCP server. It does not mean recommending or installing third-party MCP servers into users' `.claude/settings.json`.
- [ASSUMPTION] start/stop/status/logs manage the background HTTP/SSE server only. Stdio servers are spawned and owned by the client, so bare `kinet mcp` remains the foreground stdio entry point and is unaffected.
- [ASSUMPTION] Background servers are scoped per project (one per project directory), because every tool resolves context from the server's cwd. Architect decides where the run state and log files live, provided they are gitignored or outside the repo.
- [ASSUMPTION] `kinet_run_script` running only scripts declared in `package.json` is enough of a guard for a local, single-user tool. Security may tighten this (e.g. an allowlist in `kinet.config.json`).
- [ASSUMPTION] Default limits (20k-char cap, 120 s timeout, 50 log lines, 10 commits) are product defaults. Architect may adjust them if there is a technical reason, as long as they stay documented.

## 8. Open question for Security

- DNS rebinding: a localhost-only SSE server can still be reached from a malicious web page through DNS rebinding. Should the server check the `Host`/`Origin` headers (allow only `localhost`/`127.0.0.1`)? Security to decide. If yes, it becomes an AC before Developer starts.

## 9. Out of scope

- Changing or removing any of the 9 existing tools.
- Changing the top-level `kinet status` command (it stays installation health; MCP state lives under `kinet mcp status`).
- Windows-specific service handling beyond what Node's process APIs give us for free.
- Any write-capable git tool (commit, push, checkout). The AI keeps using its own shell for these, under the user's approval.
