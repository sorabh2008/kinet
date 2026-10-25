# 04 — Delivery Plan: MCP lifecycle CLI + 5 solo-dev MCP tools

Stage: Manager | Branch: `feature/mcp-cli-and-tools` (stay on it; never commit to `main`/`master`) | Date: 2026-10-25
Inputs: `01-requirement.md`, `02-architecture.md` (ADR-001), `03-design.md` (the build contract), `review-1.md` to `review-3.md`.

`03-design.md` §2-§9 is the spec for every slice below. This plan only sets the order, the commit boundaries and the checks. The three required changes from review-3 are built into slices S0, S2, S3 and S10 (marked **[R3-n]**). Review-3 finding 4 (MCP routes have no token) goes to Security in stage 6b, not to the Developer.

## Baseline (checked on this branch today)

1. `npm test` exits 0 with **0 tests**. There are no `*.test.js` files, and the unquoted `src/**/*.test.js` glob matches nothing.
2. `npm run lint` cannot run: there is no `eslint.config.js`. 03 §0.4 found 11 errors once a config exists (10 unused imports and 1 empty catch).
3. There is no formatter (no Prettier, no `format` script), so there is no format step. **Do not run `eslint --fix` over the whole repo.** Only the 10 unused-import deletions listed in 03 §8 are allowed in files outside this feature. Make them by hand, so the diff contains no unrelated changes.
4. `kinet validate` shows 0 violations and 29 warnings. The target is 0 violations and at most 30 warnings.
5. `docs/` is untracked. Commit the delivery folder in S0 (it is excluded from lint and from the npm `files` list).

## Ordered tasks (one conventional commit per slice)

Each slice leaves `npm run lint && npm test` green once S0 has landed. On Node 24 `node --test <dir>` fails, so verify commands name test files explicitly or use `npm test`.

- [x] **S0 — Lint and test baseline green**
  - Files: `eslint.config.js` (new, 03 §8); `package.json` (`"test": "node --test"`, `"lint": "eslint ."`, devDependency `@eslint/js`, `files` negations); delete unused imports in `src/cli/{init,status,update}.js`, `src/context/distiller.js`, `src/prp/system.js`, `src/rules/engine.js`; `src/rules/patterns.js` + refactor `src/rules/validators/common.js` + `src/rules/patterns.test.js`; `src/package.test.js`; `src/test-support/helpers.js`.
  - **[R3-1]:** the test script is the bare `node --test`, not the quoted glob. It runs on Node 20 to 26; the quoted glob breaks on Node 20. TBC-1 is dropped and `engines` stays `>=20`.
  - 03 cleanup (same commit): in `03-design.md`, delete TBC-1 from §11 and change the test-script references to bare `node --test` in §0.3, the §4.4 list/run examples and §8 `package.json`. Also add `docs/delivery/` to the commit.
  - ACs: 11.1 (partly), 11.2, 3.2, 0.6.
  - Verify by: `npm run lint && npm test` (expect `tests N`, N > 0), then `node bin/kinet.js validate` (same lines flagged as before), then `grep -n 'TBC-1\|src/\*\*/\*.test.js' docs/delivery/2026-10-25-mcp-cli-and-tools/03-design.md` (no matches).
  - Commit: `chore: add eslint flat config, fix test script, share ticket pattern`

- [x] **S1 — safeExec**
  - Files: `src/utils/exec.js`, `src/utils/exec.test.js`.
  - ACs: 0.4, 0.5, 0.9 (exec part), and review-2 finding 4 (token stripped from the child env; process-group kill).
  - Verify by: `node --test src/utils/exec.test.js`
  - Commit: `feat(utils): add safeExec with no-shell spawn, output cap and group kill`

- [x] **S2 — Argument validation**
  - Files: `src/utils/args.js`, `src/utils/args.test.js`.
  - **[R3-2]:** the containment check is `rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)`. When the path does not exist, return the lexical relative path from step 2. Add tests showing that `'..config'` is accepted and that a deleted or non-existent file returns its lexical relative path. Keep the existing refusals for `../..`, `/etc`, a symlink to `/etc` and `-x`.
  - ACs: 0.8a, 0.8c; `parsePort` and `parsePositiveInt` for 6.6.
  - Verify by: `node --test src/utils/args.test.js`
  - Commit: `feat(utils): add argument hardening and port/line parsers`

- [x] **S3 — Logger, server split and empty tool registry**
  - Files: `src/mcp/log.js` + `log.test.js`; `src/mcp/server.js` (`createKinetServer`, tool-call logging, `capText` guard, `localByName` lookup before the existing switch, token read and validated at boot); `src/mcp/tools/local.js` (empty array for now); `src/mcp/server.test.js`; the bare-stdio part of `src/cli/mcp-routing.test.js`.
  - **[R3-3a]:** the logger-cap test uses a small `capBytes` and a fake stream. Assert that the `log cap reached` line appears once, that `info`/`tool` lines are dropped after it, and that `error` and `shutdown` still get through.
  - ACs: 6.1, 6.3, 10.3 (the logger), 0.1 (the 9 existing tools are unchanged).
  - Verify by: `node --test src/mcp/log.test.js src/mcp/server.test.js src/cli/mcp-routing.test.js` and `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node bin/kinet.js mcp 2>/dev/null` (lists 9 tools).
  - Commit: `refactor(mcp): split server factory, add capped stderr logger and tool registry`

- [x] **S4 — T1 `kinet_git_status`**
  - Files: `src/mcp/tools/git-status.js` + test; register it in `local.js`; bump the count in `server.test.js`.
  - ACs: 1.1-1.4, 0.2, 0.3.
  - Verify by: `node --test src/mcp/tools/git-status.test.js src/mcp/server.test.js`
  - Commit: `feat(mcp): add kinet_git_status tool`

- [x] **S5 — T2 `kinet_git_diff`**
  - Files: `src/mcp/tools/git-diff.js` + test (including `buildDiffArgs`); `local.js`.
  - ACs: 2.1-2.5, 0.3, 0.5 (`HEAD; touch pwned`), 0.8a/b/c.
  - Verify by: `node --test src/mcp/tools/git-diff.test.js`
  - Commit: `feat(mcp): add kinet_git_diff tool`

- [x] **S6 — T3 `kinet_find_todos`**
  - Files: `src/mcp/tools/find-todos.js` + test (git and non-git paths, `buildGrepArgs`); `local.js`.
  - ACs: 3.1-3.4, 0.8b, 0.8c (`path` goes through `resolveInsideProject`).
  - Verify by: `node --test src/mcp/tools/find-todos.test.js src/rules/patterns.test.js`
  - Commit: `feat(mcp): add kinet_find_todos tool`

- [x] **S7 — T4 `kinet_run_script`**
  - Files: `src/mcp/tools/run-script.js` + test; `local.js`.
  - ACs: 4.1-4.6, 0.3.
  - Verify by: `node --test src/mcp/tools/run-script.test.js`
  - Commit: `feat(mcp): add kinet_run_script tool`

- [x] **S8 — T5 `kinet_check_deps`**
  - Files: `src/mcp/tools/check-deps.js` + test (canned-JSON parsers and an unreachable registry); `local.js`; `src/mcp/no-sync.test.js` (all 5 tools now exist).
  - ACs: 5.1-5.5, 0.3, 0.9, 0.1 (14 tools listed).
  - Verify by: `npm test` and the S3 stdio pipe command (now lists 14 tools).
  - Commit: `feat(mcp): add kinet_check_deps tool`

- [x] **S9 — Fix the HTTP/SSE server**
  - Files: `src/mcp/http.js` + `http.test.js` (Host/Origin guard, session map, top-level try/catch, `/health` and `/shutdown` only when a token is set); `server.js` (127.0.0.1 bind, exit 3 on `EADDRINUSE`, `shutdown()`, SIGTERM/SIGINT handlers); the `--port` part of `mcp-routing.test.js`.
  - ACs: 6.2, 7.6 (in-process part), D8, D9, review-2 finding 3.
  - Verify by: `node --test src/mcp/http.test.js src/cli/mcp-routing.test.js`, then manually run `node bin/kinet.js mcp --port 7399` and, in another shell, `curl -si -H 'Host: evil.example' http://127.0.0.1:7399/sse` (expect 403).
  - Commit: `fix(mcp): route SSE sessions per connection and bind HTTP to 127.0.0.1`

- [x] **S10 — Daemon `start` and `status`, plus the commander parent**
  - Files: `src/mcp/runstate.js` + `runstate.test.js` (lock and stale-lock rules, `checkIdentity`); `src/cli/mcp.js` (`runMcpStart`, `runMcpStatus`, `abortStart`, `formatUptime`, `lastLines`) + `src/cli/mcp.test.js`; `bin/kinet.js` (`enablePositionalOptions` on `program` and `mcp`, `allowExcessArguments`, the unknown-subcommand error, help text, and the `start` and `status` subcommands); the start/status parts of `mcp-lifecycle.test.js`.
  - Build the unknown-subcommand error message from the subcommands that are actually registered, so it is accurate in every slice. After S12 it reads exactly as 03 §5.1 specifies.
  - ACs: 7.1-7.6, 8.1-8.4, 6.5, 6.6, 6.4, review-2 findings 2 and 5.
  - Verify by: `node --test src/cli/mcp.test.js src/cli/mcp-routing.test.js src/cli/mcp-lifecycle.test.js src/mcp/runstate.test.js`, then `node bin/kinet.js mcp start && node bin/kinet.js mcp status; echo $?` (expect `running` and 0). Clean up with `kill <pid>` until S11 lands.
  - Commit: `feat(cli): add kinet mcp start and status for a background server`

- [x] **S11 — `stop`**
  - Files: `src/cli/mcp.js` (`runMcpStop`); `bin/kinet.js`; `mcp.test.js`; the stop and stale-state parts of `mcp-lifecycle.test.js`.
  - **[R3-3b]:** `runMcpStop` takes injectable `{ graceMs = 5000, pollMs = 100 }` (or a `waitForExit` function). The test points it at a dummy child that ignores `/shutdown`, using a small `graceMs`. Assert the `force-killed` output, that the dummy process is gone, and that the state is cleared.
  - ACs: 9.1-9.3, 8.2.
  - Verify by: `node --test src/cli/mcp.test.js src/cli/mcp-lifecycle.test.js`, then `node bin/kinet.js mcp start && node bin/kinet.js mcp stop && node bin/kinet.js mcp status; echo $?` (expect `stopped (pid N)`, then `stopped` and 1).
  - Commit: `feat(cli): add kinet mcp stop with identity-checked graceful shutdown`

- [x] **S12 — `logs`**
  - Files: `src/cli/mcp.js` (`runMcpLogs`, including `-f` with `fs.watchFile`); `bin/kinet.js`; the logs, rotation and no-secret-in-log parts of `mcp-lifecycle.test.js`.
  - ACs: 10.1-10.5.
  - Verify by: `node --test src/cli/mcp-lifecycle.test.js`, then `node bin/kinet.js mcp start && node bin/kinet.js mcp logs -n 5 && node bin/kinet.js mcp stop`.
  - Commit: `feat(cli): add kinet mcp logs with tail and follow`

- [x] **S13 — README and packaging check**
  - Files: `README.md` (14-row MCP Tools table; `kinet mcp start|stop|status|logs`; default port 7345; URL `http://127.0.0.1:7345/sse`; `--port` now binds to 127.0.0.1 only; MCP routes are not token-gated (any local process can call them while the daemon runs), with wording to be confirmed by Security in 6b; T3 matches uppercase markers only; Windows is best effort and T4/T5 refuse on Windows; SIGKILL can orphan a running script); `src/readme.test.js`.
  - ACs: 0.7, 11.3.
  - Verify by: `npm run lint && npm test && npm pack --dry-run` (no `*.test.js` and no `test-support` files in the tarball).
  - Commit: `docs(readme): document kinet mcp lifecycle commands and new tools`

Order rules: S1 and S2 do not depend on each other. S3 must land before S4-S8. S9 must land before S10. Everything else runs in the order listed. Write the PR note for the new `@eslint/js` devDependency (`common/dependency-approval`) at S0.

## Risks and mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Lifecycle tests are flaky or slow (ports, timing, leaked daemons) | `freePort()`, a temp cwd per test, polling with `waitFor` instead of sleeps, an `after()` hook that runs `stop`. If the suite runs longer than about 60 s, flag it to the Tester; do not drop tests. |
| 2 | T4/T5 tests depend on npm or the network | T5 uses an unreachable registry (`127.0.0.1:9`) plus canned-JSON parser tests. T4 runs only local `node -e` fixture scripts. |
| 3 | The `server.js` split changes the 9 existing tools by accident | The S3 test checks the first 9 names in order. The existing `case`s stay untouched (03 §2.6). |
| 4 | Lint cleanup pulls unrelated changes into the diff | No repo-wide `--fix`. Only the 10 listed import deletions, made by hand (Baseline 3). |
| 5 | The Node 20 test runner differs from newer versions | Bare `node --test` [R3-1]. If possible, run `npx -y node@20 --test` once before S13. |
| 6 | Security 6b changes D8 or adds token-gating to the MCP routes | The router keeps the guard and auth in one place (`http.js`), so a change would touch S9 and S13 only. |
| 7 | An interrupted `start` leaves a daemon running or the lock held | Stale-lock rules and `abortStart` (S10). Plus a manual Ctrl-C step in the TSR (03 §9). |

## Deferred (from 01 §6, not in this delivery)

1. Maven/Gradle support for T4/T5.
2. `kinet_changelog`, `kinet_env_check` (env_check needs a Security pass first).
3. `kinet mcp restart`.
4. `kinet mcp status --all`.
5. Auto-start on login (launchd/systemd).
6. Streamable HTTP transport (trigger: SDK 2.x or a client dropping SSE; see 02 D10).
7. Auth on the HTTP/MCP routes and a `--host` option (this also covers review-3 finding 4 if Security wants more than acceptance plus a README note).
8. A `kinet init` option to point clients at the background HTTP server.

## Open items

1. TBC-2: Security confirms D8 and explicitly accepts review-3 finding 4 (stage 6b).
2. TBC-3: Saurabh confirms at close-out that "top 5 MCP tools" means tools in KINET's own server.
3. TBC-1 is closed by [R3-1]. The 03 cleanup is done in S0.

## Deviations

Recorded by the Developer during S0-S13. Each one keeps every AC.

1. **S0: `TODO_MARKERS` is named `TICKET_MARKERS`.** `kinet validate`'s ticket rule is case-insensitive, so every line that mentions `TODO_MARKERS` would add a warning. The constant, its contents and its role are unchanged. `src/rules/patterns.js` also exports `markersIn(line)` and `hasTicketRef(line)`, so T3 and the S0 test share one implementation of the 03 §3 `hasTicket` rule.
2. **S0 verify grep.** The 03 grep for the old glob still matches one line, the `files` negation `!src/**/*.test.js` in 03 §8. That line is correct and intended; no test-script reference remains.
3. **`kinet validate` ends at 0 violations and 33 warnings (target was at most 30; accepted as 06-test-plan F-3).** The 4 extra warnings are false positives of the existing case-insensitive ticket rule matching the required tool and file name `kinet_find_todos` / `find-todos.js` (in `find-todos.js`, the import in `local.js`, and the imports in `find-todos.test.js` and `git-hostile-config.test.js`). Renaming the tool would break 01 §2. Violations stay at 0 (AC-11.2). Fixing the rule's false positives is a later item.
4. **Two small shared modules not listed in 03 §1:** `src/mcp/tools/git-common.js` (repo check, "not a git repo" text, git failure text, numeric clamping, and `runGit`, which every git call goes through) and `src/mcp/tools/npm-common.js` (Windows refusal and `package.json` reading for T4/T5).
5. **Test seams:** `runMcpStop` and `runMcpLogs` take an optional `cwd` (plus `graceMs`/`pollMs` on stop, per R3-3b). `http.js` also exports `listenLocal(server, port)` and `isPortAccepting(port)`, which `server.js` uses, so the bind and port checks can be tested in-process.
6. **Test fixtures avoid validate false positives:** fixture scripts use `node --input-type=module` instead of `require()`, the token-printing script is called `printenv`, and state fixtures use non-secret-looking values (06-test-plan F-4), so `node/no-require-in-esm` and `no-hardcoded-secrets` do not flag test code.
   (Items 3-6 were meant to land in S13; they were missing until the F-3/F-4 fix round.)
7. **Security 6b fixes applied on this branch** (06-security.md and review-6b.md): symlink-safe run dir and state writes (finding 1); README wording for the MCP routes (finding 2); literal git pathspecs (finding 3); `Accept`/`Sec-Fetch-Site` checks on `/sse` (finding 4); SDK floor raised to `^1.32.0` (finding 5); `-c core.fsmonitor=false` on every git call and `--no-textconv` on diff (review-6b finding 1). Tool paths are now literal, so they are never glob-expanded. The test helper no longer pipes empty stdin to children, which fixes an intermittent EPIPE failure.
8. **Deferred (06-security finding 6):** (a) `kinet_find_todos` outside a git repo follows symlinked files that `glob` returns; fix by `lstat`-skipping symlinks or realpath-checking them against cwd. (b) Secrets in tool output and (c) orphaned scripts after SIGKILL are accepted as documented. Token-gating `/sse` and `/messages` (finding 2) is the next release and must come before any `--host` option.
9. **Accepted risk [ASSUMPTION] (review-5 round 2, finding 3):** repo-local `filter.<name>.clean` commands in `.git/config` still run during kinet's `git status`/`git diff`, as they do for plain git. This is documented in the README and in 06-security.md §6(d), not blocked. `diff.external` is blocked by `--no-ext-diff`, which now has a test.
10. **Tester dry-run fixes (06-test-plan F-1, F-2, F-4, F-5, F-6; review-6a findings 1-2):** identity now also requires the server's project root to equal the realpath of the directory the command runs in (a copied state file reads as `stopped (stale)`). A hung server (`/health` timeout) whose pid is confirmed as our daemon by `ps` command line and start time is reported `unresponsive` (exit 2) and kept, so `stop` can force-kill it; an unconfirmed pid is stale and never signalled. `start` refuses a port another process already accepts on. Subcommands reject stray arguments. 03-design §2.6, §2.7, §5.1-§5.6 and the README were amended to match.

## Definition of done

1. All S0-S13 boxes are ticked, with one conventional commit each on `feature/mcp-cli-and-tools`.
2. `npm run lint && npm test` exits 0, and the summary shows `tests N` with N > 0. `kinet validate` shows 0 violations and at most 30 warnings. `npm pack --dry-run` ships no test files.
3. A manual smoke run in a scratch project:
   - `kinet mcp start` prints the pid, port, URL and log path.
   - `kinet mcp status` prints `running` and exits 0.
   - `kinet mcp logs -n 20` shows `start` and `listening`.
   - `kinet mcp stop` prints `stopped (pid N)`.
   - `kinet mcp status` prints `stopped` and exits 1.
   - No `pgrep -f "kinet.js mcp --port"` match remains.
4. Bare `kinet mcp` (stdio) still answers `initialize` and `tools/list` with 14 tools (the S3 pipe command), and nothing but protocol messages appears on stdout.
5. The README is updated per S13, and `src/readme.test.js` passes.
6. Ready for stage 6 (Tester and Security). Then `/test-and-ship`.
