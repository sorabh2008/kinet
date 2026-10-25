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

- [ ] **S11 — `stop`**
  - Files: `src/cli/mcp.js` (`runMcpStop`); `bin/kinet.js`; `mcp.test.js`; the stop and stale-state parts of `mcp-lifecycle.test.js`.
  - **[R3-3b]:** `runMcpStop` takes injectable `{ graceMs = 5000, pollMs = 100 }` (or a `waitForExit` function). The test points it at a dummy child that ignores `/shutdown`, using a small `graceMs`. Assert the `force-killed` output, that the dummy process is gone, and that the state is cleared.
  - ACs: 9.1-9.3, 8.2.
  - Verify by: `node --test src/cli/mcp.test.js src/cli/mcp-lifecycle.test.js`, then `node bin/kinet.js mcp start && node bin/kinet.js mcp stop && node bin/kinet.js mcp status; echo $?` (expect `stopped (pid N)`, then `stopped` and 1).
  - Commit: `feat(cli): add kinet mcp stop with identity-checked graceful shutdown`

- [ ] **S12 — `logs`**
  - Files: `src/cli/mcp.js` (`runMcpLogs`, including `-f` with `fs.watchFile`); `bin/kinet.js`; the logs, rotation and no-secret-in-log parts of `mcp-lifecycle.test.js`.
  - ACs: 10.1-10.5.
  - Verify by: `node --test src/cli/mcp-lifecycle.test.js`, then `node bin/kinet.js mcp start && node bin/kinet.js mcp logs -n 5 && node bin/kinet.js mcp stop`.
  - Commit: `feat(cli): add kinet mcp logs with tail and follow`

- [ ] **S13 — README and packaging check**
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
