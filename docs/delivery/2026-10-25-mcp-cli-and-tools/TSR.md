# TSR: MCP lifecycle CLI + 5 solo-dev MCP tools

- Date: 2026-10-25
- Branch: `feature/mcp-cli-and-tools`. Round 1 @ `4f813f4` (code identical to `d5a94e3`; `4f813f4` only freezes the plan). Round 2 @ `0710aa7` (BUG-1 fix). Round 3 @ `c2068cd` (BUG-2/BUG-3 fixes).
- Plan: `06-test-plan.md` as frozen at `4f813f4`, all 106 cases
- Environment: local, macOS 27.0.1 (arm64), Node v24.15.0, npm bundled, git 2.54, Claude Code 2.1.310. Fixtures under `/tmp/kinet-tsr` only, no production data.

**Full check:** `npm run lint` exit 0 · `npm test` exit 0, **117 tests, 117 pass, 0 fail**, 0 cancelled, 0 skipped · `kinet validate --json` exit 0, **0 violations, 33 warnings** (8 `no-todo-without-ticket`, 25 `no-console-log-prod`; 33 is the accepted F-3 figure).

## Round 1

Manual cases were run here, not by hand: a pty-driven interactive bash delivered real TTY Ctrl-C and terminal-close events (TC-M1, M2, M3). TC-M5 is a README read-through by the tester.

| ID | Area | Case | Expected | Actual | Result |
|----|------|------|----------|--------|--------|
| TC-S1 | Setup | Write helpers | `ok` | `ok` | PASS |
| TC-S2 | Setup | Preconditions | branch, frozen head, Node 24, ports free, no stray servers | `feature/mcp-cli-and-tools`, `4f813f4`, v24.15.0, no BUSY, `no-stray-servers=1` | PASS |
| TC-S3 | Setup | Fixtures | porcelain as listed, `FIXTURES-OK` | as listed, `FIXTURES-OK` | PASS |
| TC-1 | Gates | Test suite | exit 0, tests ≥ 117, fail 0, no leaked daemon | exit 0, 117/117, no leak | PASS |
| TC-2 | Gates | Lint | exit 0 | exit 0 | PASS |
| TC-3 | Gates | validate | 0 violations, 33 warnings | 0 violations, 33 warnings | PASS |
| TC-4 | Gates | Packaging | 0 test files in tarball | `0`, 80 files | PASS |
| TC-5 | Gates | No new prod deps | `NO-NEW-PROD-DEPS`, only SDK range raised | exactly that | PASS |
| TC-6 | Gates | No sync calls | no matches | `matches-exit=1` | PASS |
| TC-7 | Gates | Test script form | `node --test` | `node --test` | PASS |
| TC-10 | Smoke | Top-level help | exit 0, all commands | exit 0, init/update/validate/refresh/mcp/status | PASS |
| TC-11 | Smoke | `mcp --help` | 8 `has:` lines | 8 `has:`, exit 0 | PASS |
| TC-12 | Smoke | stdio tools/list | 14 tools in order, stderr `mode=stdio` | 14 in order, `INFO start mode=stdio` | PASS |
| TC-13 | Smoke | stdout protocol only | `lines=3 non-protocol=0` | `lines=3 non-protocol=0` | PASS |
| TC-14 | Smoke | New tool definitions | 5× `true object`, T4 warns | as expected | PASS |
| TC-20 | T1 | git_status in FX | branch/staged/unstaged/untracked/2 commits | exactly as expected, no `build/` | PASS |
| TC-21 | T1 | commit count | 1 commit; `"abc"` → 2 | `recent commits (1)`; `(2)` | PASS |
| TC-22 | T1/T2/T3 | Read-only | `UNCHANGED`, `NO-LOCK` | both | PASS |
| TC-23 | T1 | Upstream ahead/behind | `ahead 1, behind 0` | `(upstream origin/feature, ahead 1, behind 0)` | PASS |
| TC-24 | T1 | Detached HEAD | `(detached HEAD at <hash>)` | `(detached HEAD at 40c42ba)` | PASS |
| TC-25 | T1/T2 | No commits | `no commits yet`, plain diff message | both | PASS |
| TC-26 | T2 | working diff | label, stat, ± lines | exact | PASS |
| TC-27 | T2 | staged diff | `src/staged.js` only | exact | PASS |
| TC-28 | T2 | ref diff | `main...HEAD`, `src/b.js` | exact | PASS |
| TC-29 | T2 | path filter | c.js only / No changes / b.js | exact | PASS |
| TC-30 | T2 | Unknown ref | `Unknown ref "nope-ref"…` | exact | PASS |
| TC-31 | T2 | No changes | both `No changes (…)` texts | exact | PASS |
| TC-32 | T2 | Arg validation | two `isError=true` messages | exact | PASS |
| TC-33 | T2 | Output cap | len ≤ 20000, marker | `len=18201 marker=true` | PASS |
| TC-34 | T3 | find_todos git | 5 lines, 5/3 | exact | PASS |
| TC-35 | T3 | filters | 3 exact lines | exact | PASS |
| TC-36 | T3 | non-git fallback | 5/3, same lines | exact | PASS |
| TC-38 | T4 | list mode | 5 scripts listed | exact | PASS |
| TC-39 | T4 | passing script | exit 0, `42` | exact | PASS |
| TC-40 | T4 | failing script | exit 3, `boom`, server still answers | exact, `tools=14` | PASS |
| TC-41 | T4 | timeout | timed out after 2 s, no orphan | `duration: 2.0 s`, `orphans-exit=1` | PASS |
| TC-42 | T4 | long output tail | len ≤ 20000, earlier marker, tail, exit 0 | `len=18156` all true | PASS |
| TC-43 | T4 | token stripped | `token=undefined` | `token=undefined` | PASS |
| TC-44 | Async | answers while script runs | arrival `3,4,2` | `3,4,2` | PASS |
| TC-45 | T5 | no lockfile | outdated 0, audit error, pkg unchanged | exact, `PKG-UNCHANGED`, `NO-LOCKFILE` | PASS |
| TC-46 | T5 | section selection | audit only / outdated only / error | exact | PASS |
| TC-47 | T5 | unreachable registry | per-section errors, byte-identical | `registry unreachable (ECONNREFUSED)` ×2, `BYTE-IDENTICAL` | PASS |
| TC-48 | T5 | real registry (network) | shapes per AC-5.1/5.2, byte-identical | 10 outdated (e.g. `@anthropic-ai/sdk` 0.52.0→1.3.0 prod); audit counts critical 1/high 7/moderate 2; `BYTE-IDENTICAL` | PASS |
| TC-49 | Tools | not git / no package.json | 4 plain messages | exact | PASS |
| TC-55 | Neg | `ref` option injection | refused ×2, `NO-FILE` | exact | PASS |
| TC-56 | Neg | `path` option injection | refused ×3, `NO-FILE` | exact | PASS |
| TC-57 | Neg | path escape (incl. symlink) | 6 refusals, FX restored | exact, `0` | PASS |
| TC-58 | Neg | shell metacharacters | literal refs/paths, 0 pwn files | exact, `0` | PASS |
| TC-59 | Neg | only declared scripts | 4 refusals, 0 pwn files | exact, `0` | PASS |
| TC-60 | Neg | unknown tool | `Unknown tool: kinet_nope` | exact | PASS |
| TC-61 | Neg | missing path | `Path not found: nope` | exact | PASS |
| TC-64 | T4 | single-flight | slow runs, ok refused | exact | PASS |
| TC-62 | Neg | pathspec magic literal | No changes ×3, `Path not found: :/`, control diff | exact | PASS |
| TC-63 | Neg | hostile .git/config | 5 results, `0` hooks ran, control fires | exact (`fsmonitor-ran` only from plain git) | PASS |
| TC-70 | CLI | status before start | `stopped`, exit 1, no `.kinet` | exact | PASS |
| TC-71 | CLI | logs before start | `no logs — …`, exit 1 | exact | PASS |
| TC-72 | CLI | start default port | block A, exit 0, < 5 s | exact, `real 0.17` | PASS |
| TC-73 | CLI | run state | modes 600/700, ignored, keys, detached | exact (PPID 1, own PGID, TTY `??`) | PASS |
| TC-74 | CLI | second start | already running, same pid, 1 process | exact | PASS |
| TC-75 | CLI | status running | block B, exit 0 | exact | PASS |
| TC-76 | CLI | 127.0.0.1 only | one LISTEN `127.0.0.1:7345`, LAN/::1 refused | exact | PASS |
| TC-77 | CLI | SSE session in FX | 202s, 14 tools, `branch: feature` | exact | PASS |
| TC-78 | CLI | logs tail | 5 lines, default = file lines, `--lines 2` | `5`, `6`, `2` | PASS |
| TC-79 | CLI | logs -f | exit 0, marker seen | `exit=0`, `1` | PASS |
| TC-80 | CLI | status changes nothing | `1` | `1` | PASS |
| TC-81 | CLI | no secrets in log | `0` `0` | `0` `0` | PASS |
| TC-82 | CLI | stop | `stopped (pid N)`, gone, port free, state cleared | exact, `real 0.14` | PASS |
| TC-83 | CLI | stop when stopped | `not running`, exit 0 | exact | PASS |
| TC-84 | CLI | log survives stop | lifecycle lines in order | exact | PASS |
| TC-85 | CLI | log rotation | `mcp.log.1` holds prior run | exact | PASS |
| TC-86 | CLI | `--port` forwarding | 47312, then 47311 (sub wins) | exact | PASS |
| TC-90 | Neg | unknown subcommand | error ×2, exit 1, < 3 s, none started | exact, `real 0.02` | PASS |
| TC-87 | Neg | stray args ×4 | `too many arguments` ×4, exit 1, no daemon/state | exact | PASS |
| TC-91 | Neg | parent `--port` refused | 3× error, exit 1 | exact | PASS |
| TC-92 | Neg | bad option values | all exit 1 with commander errors | exact | PASS |
| TC-93 | Neg | port busy 127.0.0.1 | error, exit 1, no state/orphan | exact | PASS |
| TC-94 | Neg | port busy wildcard | error, exit 1, only `*:47314` | exact | PASS |
| TC-95 | Neg | fg busy port | exit 3 | `ERROR port 47313 is in use`, exit 3 | PASS |
| TC-96 | Robust | stale state, live unrelated pid | stale/cleared, unrelated alive | exact | PASS |
| TC-97 | Robust | dead pid / corrupt state | stale; stopped; restart ok | exact | PASS |
| TC-98 | Robust | copied project state | stale, OTHER alive, own server started | exact, `DIFFERENT-PID` | PASS |
| TC-99 | Robust | start locks | 4 lock scenarios as listed | exact | PASS |
| TC-100 | Robust | concurrent starts | exactly one daemon | 1 daemon, loser got lock error exit 1 | PASS |
| TC-101 | Robust | hung daemon | `unresponsive` exit 2, start refused, force-kill 5-8 s | exact, `real 7.17` | PASS |
| TC-106 | Robust | hanging decoy never signalled | stale ×2, decoy alive ×2 | exact | PASS |
| TC-102 | Robust | two projects | same port refused; independent stops | exact | PASS |
| TC-103 | Robust | bad token | exit 1 ×2 | exact | PASS |
| TC-104 | Robust | external SIGTERM | `shutdown reason=SIGTERM`, stale | exact | PASS |
| TC-105 | Security | symlinked run dir | refused ×2, nothing written | exact | PASS |
| TC-110 | HTTP | Host guard | 403/403/200/200 | exact | PASS |
| TC-111 | HTTP | Origin guard | 403/200/200/403 | exact | PASS |
| TC-112 | HTTP | token routes | 401/401/200/401/404/404/404, still running | exact | PASS |
| TC-113 | HTTP | foreground `--port` | 127.0.0.1, 404s, 14 tools, SIGINT exit 0, no state | exact | PASS |
| TC-114 | HTTP | session cap | 17th 503 | `17th 503` | PASS |
| TC-115 | HTTP | Accept / Sec-Fetch-Site | 406, 403, 403, 200, 200 | exact | PASS |
| TC-120 | Regression | 9 core tools vs develop | `IDENTICAL` | `IDENTICAL` | PASS |
| TC-121 | Regression | network tools (network) | results or readable error | web_search `[]`; github_search readable `401 Requires authentication` (no token set) | PASS |
| TC-122 | Regression | memory round trip | saved, recalled by title | exact | PASS |
| TC-123 | Regression | init writes `args: ['mcp']` | as listed | exact | PASS |
| TC-124 | Regression | status/validate on repo | exit 0 ×2 | exit 0 ×2 | PASS |
| TC-125 | Regression | update/refresh/--version | all exit 0, REGENERATED, 1.0.1 | exact | PASS |
| TC-M1 | Manual | Ctrl-C during start | exit 130, stopped, **no `mcp.lock`**, no orphan | Real-TTY Ctrl-C at 30 ms and 60 ms left `mcp.lock` behind. A 60-trial SIGINT sweep left the lock 4×, two of them empty, and an empty lock blocks a retry for 10 s. Exit 130, `stopped`, no orphans throughout. M1a as written: d=0.05-0.12 all pass; at d=0.03 the signal was ignored because non-interactive bash runs background jobs with SIGINT ignored until Node installs its handler, so `start` completed (`running`), which is a harness artefact. → **BUG-1** | FAIL |
| TC-M2 | Manual | outlives its terminal | `running` same pid after window close | started pid 44895; pty closed (SIGHUP); `running pid 44895`; `stopped (pid 44895)` | PASS |
| TC-M3 | Manual | logs -f + Ctrl-C | new lines stream, exit 0, no trace | marker and `shutdown reason=http` streamed; Ctrl-C → `EXIT=0`; no stack trace | PASS |
| TC-M4 | Manual | real Claude Code client | `/mcp` shows kinet with 14 tools; a tool call works | Claude Code 2.1.310 `claude mcp list` saw both `kinet-stdio` and `kinet-sse` but holds them as `⏸ Pending approval (run claude to approve)` | BLOCKED |
| TC-M5 | Manual | README reads true | 14 tools, lifecycle cmds, 127.0.0.1, limits | All true against observed behaviour (exit 0/1/2, force-kill after 5 s, 7345, 127.0.0.1, orphan and Windows notes, lowercase `todo` note). "Linux supported" is not verified here. | PASS |

**Pass rate: 104 / 106 = 98.1 %** (1 FAIL, 1 BLOCKED).

**Open defects:**
1. BUG-1 (Low): Ctrl-C very early in `start` can leave `mcp.lock`. An empty lock blocks `start` for 10 s with `another 'kinet mcp start' is running … (pid unknown)`. See `bugs/BUG-1.md`.

**Observations (not defects of this feature):**
1. TC-48: `npm audit` on kinet's own lockfile reports 10 advisories (1 critical, 7 high, 2 moderate; e.g. `body-parser`, `brace-expansion`), and `@anthropic-ai/sdk` is 0.52.0 vs latest 1.3.0. These predate this branch and are worth a separate dependency pass.
2. TC-121: `kinet_github_search` returns a readable 401 without `GITHUB_TOKEN`. This is unchanged existing behaviour.

**BLOCKED reason (TC-M4):** Claude Code only connects project-scope servers after someone approves them in an interactive `claude` session. Approving changes Saurabh's Claude config (`~/.claude.json`, unchanged by this run, checksum `3755a853fa37` before and after). The second half of the case asks the model to call `kinet_git_status`, which uses his account. Both are his to do. To finish it: in `/tmp`-style scratch, open `claude`, approve `kinet-stdio`/`kinet-sse`, run `/mcp` (expect 14 tools each), and ask it to run `kinet_git_status`. The wire protocol both entries use is already covered by TC-12 (stdio) and TC-77/TC-113 (SSE).

## Round 2

- Date: 2026-10-25
- Branch: `feature/mcp-cli-and-tools` @ `0710aa7` (BUG-1 fix). The frozen plan is unchanged since `4f813f4`.
- Environment: local, macOS 27.0.1 (arm64), Node v24.15.0, Claude Code 2.1.310.
- Scope: all 106 frozen cases re-run from scratch (fresh fixtures), plus the new regression case **TC-B1**. No case was removed or weakened. Manual terminal cases used a pty-driven interactive bash, so Ctrl-C and window close were real TTY events.

**Full check:** `npm run lint` exit 0 · `npm test` exit 0, **120 tests, 120 pass, 0 fail**, 0 cancelled, 0 skipped · `kinet validate --json` exit 0, **0 violations, 33 warnings**.

| ID | Area | Case | Expected | Actual | Result |
|----|------|------|----------|--------|--------|
| TC-S1 | Setup | Write helpers | `ok` | `ok` | PASS |
| TC-S2 | Setup | Preconditions | branch, head, Node 24, ports free | `feature/mcp-cli-and-tools`, `0710aa7`, v24.15.0, `no-stray-servers=1` | PASS |
| TC-S3 | Setup | Fixtures | listed porcelain, `FIXTURES-OK` | as listed | PASS |
| TC-1 | Gates | Test suite | exit 0, ≥ 117 tests, fail 0, no leak | exit 0, 120/120, no leaked daemon | PASS |
| TC-2 | Gates | Lint | exit 0 | exit 0 | PASS |
| TC-3 | Gates | validate | 0 violations, 33 warnings | 0 / 33 | PASS |
| TC-4 | Gates | Packaging | 0 test files | `0`, 80 files | PASS |
| TC-5 | Gates | No new prod deps | `NO-NEW-PROD-DEPS` | as expected | PASS |
| TC-6 | Gates | No sync calls | no matches, `matches-exit=1` | `src/cli/mcp.js:4` and `:76` match `readFileSync` (added by `0710aa7` in the signal handler), `matches-exit=0` → **BUG-3** | FAIL |
| TC-7 | Gates | Test-script form | `node --test` | `node --test` | PASS |
| TC-10 | Smoke | Top-level help | exit 0, all commands | as expected | PASS |
| TC-11 | Smoke | `mcp --help` | 8 `has:` | 8 `has:` | PASS |
| TC-12 | Smoke | stdio tools/list | 14 in order, `mode=stdio` | as expected | PASS |
| TC-13 | Smoke | stdout protocol only | `lines=3 non-protocol=0` | as expected | PASS |
| TC-14 | Smoke | New tool definitions | 5× `true object`, T4 warns | as expected | PASS |
| TC-20 | T1 | git_status in FX | as listed | exact | PASS |
| TC-21 | T1 | commit count | 1; fallback 2 | exact | PASS |
| TC-22 | T1-T3 | Read-only | `UNCHANGED`, `NO-LOCK` | both | PASS |
| TC-23 | T1 | ahead/behind | `ahead 1, behind 0` | exact | PASS |
| TC-24 | T1 | Detached HEAD | `(detached HEAD at …)` | `(detached HEAD at d7317c1)` | PASS |
| TC-25 | T1/T2 | No commits | `no commits yet`; plain diff msg | exact | PASS |
| TC-26 | T2 | working | label, stat, ± lines | exact | PASS |
| TC-27 | T2 | staged | `src/staged.js` only | exact | PASS |
| TC-28 | T2 | ref | `main...HEAD`, `src/b.js` | exact | PASS |
| TC-29 | T2 | path filter | c.js / No changes / b.js | exact | PASS |
| TC-30 | T2 | Unknown ref | names the ref | exact | PASS |
| TC-31 | T2 | No changes | two `No changes (…)` texts | exact | PASS |
| TC-32 | T2 | Arg validation | two errors | exact | PASS |
| TC-33 | T2 | Output cap | ≤ 20000, marker | `len=18201 marker=true` | PASS |
| TC-34 | T3 | find_todos git | 5 lines, 5/3 | exact | PASS |
| TC-35 | T3 | filters | 3 exact lines | exact | PASS |
| TC-36 | T3 | non-git fallback | 5/3 | exact | PASS |
| TC-38 | T4 | list mode | 5 scripts | exact | PASS |
| TC-39 | T4 | passing script | exit 0, `42` | exact | PASS |
| TC-40 | T4 | failing script | exit 3, `boom`, server answers | exact | PASS |
| TC-41 | T4 | timeout | 2 s, no orphan | `duration: 2.0 s`, `orphans-exit=1` | PASS |
| TC-42 | T4 | long output tail | all true | `len=18156` all true | PASS |
| TC-43 | T4 | token stripped | `token=undefined` | exact | PASS |
| TC-44 | Async | answers while script runs | `3,4,2` | `3,4,2` | PASS |
| TC-45 | T5 | no lockfile | as listed | exact | PASS |
| TC-46 | T5 | section selection | as listed | exact | PASS |
| TC-47 | T5 | unreachable registry | per-section errors, byte-identical | exact | PASS |
| TC-48 | T5 | real registry (network) | shapes, byte-identical | 10 outdated, audit 1/7/2, `BYTE-IDENTICAL` | PASS |
| TC-49 | Tools | not git / no package.json | 4 plain messages | exact | PASS |
| TC-55 | Neg | ref option injection | refused, `NO-FILE` | exact | PASS |
| TC-56 | Neg | path option injection | refused, `NO-FILE` | exact | PASS |
| TC-57 | Neg | path escape | 6 refusals, restored | exact | PASS |
| TC-58 | Neg | shell metacharacters | literal, 0 files | exact | PASS |
| TC-59 | Neg | only declared scripts | 4 refusals, 0 files | exact | PASS |
| TC-60 | Neg | unknown tool | `Unknown tool` | exact | PASS |
| TC-61 | Neg | missing path | `Path not found: nope` | exact | PASS |
| TC-64 | T4 | single-flight | id=2 `slow` runs, id=3 refused with `(slow)` | id=2 `A script is already running (ok)`, id=3 ran `ok`. Over 20 runs: slow-won 14, ok-won 6. Exactly one ran every time (design §4.4 holds), but the frozen order is not deterministic → **BUG-4** (test defect) | FAIL |
| TC-62 | Neg | pathspec magic | as listed | exact | PASS |
| TC-63 | Neg | hostile .git/config | 0 hooks ran, control fires | exact | PASS |
| TC-70 | CLI | status before start | `stopped`, 1, no `.kinet` | exact | PASS |
| TC-71 | CLI | logs before start | `no logs — …`, 1 | exact | PASS |
| TC-72 | CLI | start default port | block A, < 5 s | exact, `real 0.25` | PASS |
| TC-73 | CLI | run state | 600/700, ignored, detached | exact | PASS |
| TC-74 | CLI | second start | already running, 1 process | exact | PASS |
| TC-75 | CLI | status running | block B | exact | PASS |
| TC-76 | CLI | 127.0.0.1 only | one LISTEN, LAN/::1 refused | exact | PASS |
| TC-77 | CLI | SSE session | 202s, 14 tools, FX | exact | PASS |
| TC-78 | CLI | logs tail | 5 / file lines / 2 | `5`, `6`, `2` | PASS |
| TC-79 | CLI | logs -f | exit 0, marker | exact | PASS |
| TC-80 | CLI | status changes nothing | `1` | `1` | PASS |
| TC-81 | CLI | no secrets in log | `0` `0` | exact | PASS |
| TC-82 | CLI | stop | graceful, cleared | exact, `real 0.14` | PASS |
| TC-83 | CLI | stop when stopped | `not running` | exact | PASS |
| TC-84 | CLI | log survives stop | lifecycle lines | exact | PASS |
| TC-85 | CLI | rotation | `mcp.log.1` prior run | exact | PASS |
| TC-86 | CLI | `--port` forwarding | 47312, 47311 | exact | PASS |
| TC-90 | Neg | unknown subcommand | error ×2, none started | exact | PASS |
| TC-87 | Neg | stray args ×4 | exact errors, no daemon/state | exact | PASS |
| TC-91 | Neg | parent `--port` refused | 3× error | exact | PASS |
| TC-92 | Neg | bad option values | all exit 1 | exact | PASS |
| TC-93 | Neg | port busy 127.0.0.1 | error, no state/orphan | exact | PASS |
| TC-94 | Neg | port busy wildcard | error, only `*:47314` | exact | PASS |
| TC-95 | Neg | fg busy port | exit 3 | exact | PASS |
| TC-96 | Robust | stale state, unrelated pid | stale, alive | exact | PASS |
| TC-97 | Robust | dead pid / corrupt | stale; stopped; restart | exact | PASS |
| TC-98 | Robust | copied project | stale, OTHER alive, own server | exact | PASS |
| TC-99 | Robust | start locks | 4 scenarios | exact | PASS |
| TC-100 | Robust | concurrent starts | one daemon | 1 daemon (A lost with lock error) | PASS |
| TC-101 | Robust | hung daemon | unresponsive/2, refuse, force-kill 5-8 s | exact, `real 7.15` | PASS |
| TC-106 | Robust | hanging decoy | never signalled | exact | PASS |
| TC-102 | Robust | two projects | as listed | exact | PASS |
| TC-103 | Robust | bad token | exit 1 ×2 | exact | PASS |
| TC-104 | Robust | external SIGTERM | shutdown line, stale | exact | PASS |
| TC-105 | Security | symlinked run dir | refused ×2 | exact | PASS |
| TC-110 | HTTP | Host guard | 403/403/200/200 | exact | PASS |
| TC-111 | HTTP | Origin guard | 403/200/200/403 | exact | PASS |
| TC-112 | HTTP | token routes | as listed | exact | PASS |
| TC-113 | HTTP | foreground `--port` | as listed | exact | PASS |
| TC-114 | HTTP | session cap | 17th 503 | exact | PASS |
| TC-115 | HTTP | Accept / Sec-Fetch-Site | 406/403/403/200/200 | exact | PASS |
| TC-120 | Regression | core tools vs develop | `IDENTICAL` | exact | PASS |
| TC-121 | Regression | network tools | results or readable error | `[]`; readable GitHub 401 | PASS |
| TC-122 | Regression | memory round trip | saved, recalled | exact | PASS |
| TC-123 | Regression | init `args: ['mcp']` | as listed | exact | PASS |
| TC-124 | Regression | status/validate | exit 0 ×2 | exact | PASS |
| TC-125 | Regression | update/refresh/--version | as listed | exact | PASS |
| TC-B1 | Regression (new) | BUG-1 repro loop: 60 SIGINTs via `kill -INT` at 20-130 ms | 0 stale locks (`mcp.lock` or `mcp.lock.*.tmp`), no orphan | `trials=60 interrupted(130)=60 lock-leaks=0 / 60`, `no-orphan=1` | PASS |
| TC-M1 | Manual | Ctrl-C during start | exit 130, stopped, no `mcp.lock`, no orphan | M1a as written: 5/5 clean. Real TTY, 192 trials in 4 batches: 4 left a dead-pid `mcp.lock`, each with the signal handler crashing with uncaught `Error: kill EPERM` (`src/cli/mcp.js:63`) and exit 1. 0 orphans → **BUG-2** | FAIL |
| TC-M2 | Manual | outlives its terminal | `running` same pid after close | pid 70702 started; window closed; `running pid 70702`; `stopped (pid 70702)` | PASS |
| TC-M3 | Manual | logs -f + Ctrl-C | streams, exit 0, no trace | marker and shutdown streamed; `EXIT=0`; no trace | PASS |
| TC-M4 | Manual | real Claude Code client | `/mcp` shows kinet with 14 tools; a tool call works | Not run: it needs approval inside Saurabh's Claude config and a model call on his account. Steps are under "For Saurabh" below | BLOCKED |
| TC-M5 | Manual | README reads true | claims match behaviour | README unchanged since round 1; claims still match round-2 results. Linux is not verified | PASS |

**Pass rate (round 2): 103 / 107 = 96.3 %** (3 FAIL, 1 BLOCKED). Round 1 was 104/106 = 98.1 % against a plan without TC-B1.

**Defects:**
1. BUG-1: **fixed in `0710aa7`, verified** for the reported path (TC-B1 0/60). Status recorded in `bugs/BUG-1.md`.
2. BUG-2 (Low, new, open): under a real terminal, Ctrl-C during `start` can crash the handler with `kill EPERM`, leaving exit 1, a stack trace and a dead-pid lock (about 2%). This is the residual path of BUG-1. `bugs/BUG-2.md`.
3. BUG-3 (Low, new, open; introduced by `0710aa7`): `readFileSync`/`unlinkSync` in `src/cli/mcp.js` fail the frozen TC-6 gate (AC-0.9). There is no runtime impact. It needs a code change or a reviewed design/plan amendment. `bugs/BUG-3.md`.
4. BUG-4 (Low, open; test-plan defect): TC-64 is non-deterministic (6/20 runs fail). The product meets design §4.4. It needs a reviewed plan amendment, or FIFO slot claiming. `bugs/BUG-4.md`.

**Observations (unchanged from round 1):** `npm audit` on kinet's own lockfile reports 10 advisories (1 critical). `kinet_github_search` returns a readable 401 without `GITHUB_TOKEN`.

## Round 3

- Date: 2026-10-25
- Branch: `feature/mcp-cli-and-tools` @ `c2068cd` (BUG-2 and BUG-3 fixes).
- Environment: local, macOS 27.0.1 (arm64), Node v24.15.0, Claude Code 2.1.310.
- Scope: all 107 cases from round 2 re-run from scratch (fresh fixtures), plus the new **TC-B2**, so **108 cases**. No case was removed or weakened. Manual terminal cases ran through a pty-driven interactive bash (real TTY Ctrl-C and window close).

**Plan corrections made this round (in `06-test-plan.md`):**
1. **TC-64 corrected (BUG-4, test-case defect).**
   - Why: the round-2 step sent both `run_script` calls at once and expected `slow` to win. The server handles the calls concurrently and claims the slot only after reading `package.json`, so either call could win (`ok` won 6 of 20 runs).
   - What changed: the case now sends `slow`, waits until its process is confirmed running (`pgrep` → `slow-confirmed-running`), and only then sends `ok`.
   - The assertion is the same strength: exactly one script runs, and the other gets the documented `A script is already running (slow); wait for it to finish.` with no `exit code:` line.
   - Verified 20/20 identical.
2. **TC-B1 and TC-B2 recorded in the plan** (new §10b "Regression cases added at the release gate", traced to AC-7.5). TC-B1 was added in round 2 but lived only in this TSR until now.

**Full check:** `npm run lint` exit 0 · `npm test` exit 0, **121 tests, 121 pass, 0 fail**, 0 cancelled, 0 skipped · `kinet validate --json` exit 0, **0 violations, 33 warnings**.

| ID | Area | Case | Expected | Actual | Result |
|----|------|------|----------|--------|--------|
| TC-S1 | Setup | Write helpers | `ok` | `ok` | PASS |
| TC-S2 | Setup | Preconditions | branch, head, Node 24, ports free | `feature/mcp-cli-and-tools`, `c2068cd`, v24.15.0, `no-stray-servers=1` | PASS |
| TC-S3 | Setup | Fixtures | listed porcelain, `FIXTURES-OK` | as listed | PASS |
| TC-1 | Gates | Test suite | exit 0, ≥ 117, fail 0, no leak | exit 0, 121/121, no leak | PASS |
| TC-2 | Gates | Lint | exit 0 | exit 0 | PASS |
| TC-3 | Gates | validate | 0 / 33 | 0 / 33 | PASS |
| TC-4 | Gates | Packaging | 0 test files | `0`, 80 files | PASS |
| TC-5 | Gates | No new prod deps | `NO-NEW-PROD-DEPS` | as expected | PASS |
| TC-6 | Gates | No sync calls | no matches, `matches-exit=1` | `matches-exit=1` (BUG-3 fixed) | PASS |
| TC-7 | Gates | Test-script form | `node --test` | `node --test` | PASS |
| TC-10 | Smoke | Top-level help | exit 0, all commands | as expected | PASS |
| TC-11 | Smoke | `mcp --help` | 8 `has:` | 8 `has:` | PASS |
| TC-12 | Smoke | stdio tools/list | 14 in order, `mode=stdio` | as expected | PASS |
| TC-13 | Smoke | stdout protocol only | `lines=3 non-protocol=0` | as expected | PASS |
| TC-14 | Smoke | New tool definitions | 5× `true object`, T4 warns | as expected | PASS |
| TC-20 | T1 | git_status in FX | as listed | exact | PASS |
| TC-21 | T1 | commit count | 1; fallback 2 | exact | PASS |
| TC-22 | T1-T3 | Read-only | `UNCHANGED`, `NO-LOCK` | both | PASS |
| TC-23 | T1 | ahead/behind | `ahead 1, behind 0` | exact | PASS |
| TC-24 | T1 | Detached HEAD | `(detached HEAD at …)` | `(detached HEAD at e7ad7a4)` | PASS |
| TC-25 | T1/T2 | No commits | as listed | exact | PASS |
| TC-26 | T2 | working | label, stat, ± lines | exact | PASS |
| TC-27 | T2 | staged | `src/staged.js` only | exact | PASS |
| TC-28 | T2 | ref | `main...HEAD`, `src/b.js` | exact | PASS |
| TC-29 | T2 | path filter | c.js / No changes / b.js | exact | PASS |
| TC-30 | T2 | Unknown ref | names the ref | exact | PASS |
| TC-31 | T2 | No changes | two texts | exact | PASS |
| TC-32 | T2 | Arg validation | two errors | exact | PASS |
| TC-33 | T2 | Output cap | ≤ 20000, marker | `len=18201 marker=true` | PASS |
| TC-34 | T3 | find_todos git | 5 lines, 5/3 | exact | PASS |
| TC-35 | T3 | filters | 3 exact lines | exact | PASS |
| TC-36 | T3 | non-git fallback | 5/3 | exact | PASS |
| TC-38 | T4 | list mode | 5 scripts | exact | PASS |
| TC-39 | T4 | passing script | exit 0, `42` | exact | PASS |
| TC-40 | T4 | failing script | exit 3, `boom`, server answers | exact | PASS |
| TC-41 | T4 | timeout | 2 s, no orphan | exact | PASS |
| TC-42 | T4 | long output tail | all true | `len=18156` all true | PASS |
| TC-43 | T4 | token stripped | `token=undefined` | exact | PASS |
| TC-44 | Async | answers while script runs | `3,4,2` | `3,4,2` | PASS |
| TC-45 | T5 | no lockfile | as listed | exact | PASS |
| TC-46 | T5 | section selection | as listed | exact | PASS |
| TC-47 | T5 | unreachable registry | per-section errors, byte-identical | exact | PASS |
| TC-48 | T5 | real registry (network) | shapes, byte-identical | 10 outdated, audit 1/7/2, `BYTE-IDENTICAL` | PASS |
| TC-49 | Tools | not git / no package.json | 4 plain messages | exact | PASS |
| TC-55 | Neg | ref option injection | refused, `NO-FILE` | exact | PASS |
| TC-56 | Neg | path option injection | refused, `NO-FILE` | exact | PASS |
| TC-57 | Neg | path escape | 6 refusals, restored | exact | PASS |
| TC-58 | Neg | shell metacharacters | literal, 0 files | exact | PASS |
| TC-59 | Neg | only declared scripts | 4 refusals, 0 files | exact | PASS |
| TC-60 | Neg | unknown tool | `Unknown tool` | exact | PASS |
| TC-61 | Neg | missing path | `Path not found: nope` | exact | PASS |
| TC-64 | T4 | single-flight (corrected, deterministic) | `pre-slow=1`; id=2 slow times out after 4 s; id=3 busy `(slow)`, no `exit code:`; `slow-confirmed-running` | exact; repeated 20× with 20/20 identical | PASS |
| TC-62 | Neg | pathspec magic | as listed | exact | PASS |
| TC-63 | Neg | hostile .git/config | 0 hooks ran, control fires | exact | PASS |
| TC-70 | CLI | status before start | `stopped`, 1, no `.kinet` | exact | PASS |
| TC-71 | CLI | logs before start | `no logs — …`, 1 | exact | PASS |
| TC-72 | CLI | start default port | block A, < 5 s | exact, `real 0.26` | PASS |
| TC-73 | CLI | run state | 600/700, ignored, detached | exact | PASS |
| TC-74 | CLI | second start | already running, 1 process | exact | PASS |
| TC-75 | CLI | status running | block B | exact | PASS |
| TC-76 | CLI | 127.0.0.1 only | one LISTEN, LAN/::1 refused | exact | PASS |
| TC-77 | CLI | SSE session | 202s, 14 tools, FX | exact | PASS |
| TC-78 | CLI | logs tail | 5 / file lines / 2 | `5`, `6`, `2` | PASS |
| TC-79 | CLI | logs -f | exit 0, marker | exact | PASS |
| TC-80 | CLI | status changes nothing | `1` | `1` | PASS |
| TC-81 | CLI | no secrets in log | `0` `0` | exact | PASS |
| TC-82 | CLI | stop | graceful, cleared | exact, `real 0.14` | PASS |
| TC-83 | CLI | stop when stopped | `not running` | exact | PASS |
| TC-84 | CLI | log survives stop | lifecycle lines | exact | PASS |
| TC-85 | CLI | rotation | `mcp.log.1` prior run | exact | PASS |
| TC-86 | CLI | `--port` forwarding | 47312, 47311 | exact | PASS |
| TC-90 | Neg | unknown subcommand | error ×2, none started | exact | PASS |
| TC-87 | Neg | stray args ×4 | exact errors, no daemon/state | exact | PASS |
| TC-91 | Neg | parent `--port` refused | 3× error | exact | PASS |
| TC-92 | Neg | bad option values | all exit 1 | exact | PASS |
| TC-93 | Neg | port busy 127.0.0.1 | error, no state/orphan | exact | PASS |
| TC-94 | Neg | port busy wildcard | error, only `*:47314` | exact | PASS |
| TC-95 | Neg | fg busy port | exit 3 | exact | PASS |
| TC-96 | Robust | stale state, unrelated pid | stale, alive | exact | PASS |
| TC-97 | Robust | dead pid / corrupt | stale; stopped; restart | exact | PASS |
| TC-98 | Robust | copied project | stale, OTHER alive, own server | exact | PASS |
| TC-99 | Robust | start locks | 4 scenarios | exact | PASS |
| TC-100 | Robust | concurrent starts | one daemon | 1 daemon (B lost with lock error) | PASS |
| TC-101 | Robust | hung daemon | unresponsive/2, refuse, force-kill 5-8 s | exact, `real 7.13` | PASS |
| TC-106 | Robust | hanging decoy | never signalled | exact | PASS |
| TC-102 | Robust | two projects | as listed | exact | PASS |
| TC-103 | Robust | bad token | exit 1 ×2 | exact | PASS |
| TC-104 | Robust | external SIGTERM | shutdown line, stale | exact | PASS |
| TC-105 | Security | symlinked run dir | refused ×2 | exact | PASS |
| TC-110 | HTTP | Host guard | 403/403/200/200 | exact | PASS |
| TC-111 | HTTP | Origin guard | 403/200/200/403 | exact | PASS |
| TC-112 | HTTP | token routes | as listed | exact | PASS |
| TC-113 | HTTP | foreground `--port` | as listed | exact | PASS |
| TC-114 | HTTP | session cap | 17th 503 | exact | PASS |
| TC-115 | HTTP | Accept / Sec-Fetch-Site | 406/403/403/200/200 | exact | PASS |
| TC-120 | Regression | core tools vs develop | `IDENTICAL` | exact | PASS |
| TC-121 | Regression | network tools | results or readable error | `[]`; readable GitHub 401 | PASS |
| TC-122 | Regression | memory round trip | saved, recalled | exact | PASS |
| TC-123 | Regression | init `args: ['mcp']` | as listed | exact | PASS |
| TC-124 | Regression | status/validate | exit 0 ×2 | exact | PASS |
| TC-125 | Regression | update/refresh/--version | as listed | exact | PASS |
| TC-B1 | Release-gate regression | BUG-1: 60 × `kill -INT` during start | 0 stale locks, all 130, no orphan | `trials=60 interrupted(130)=60 lock-leaks=0 / 60`, `no-orphan=1` | PASS |
| TC-B2 | Release-gate regression (new) | BUG-2: 192 real-terminal (pty) Ctrl-Cs at 20-125 ms | 0 crashes, 0 stale locks, exit 130 every time, no orphan | `trials=192 crashes=0 stale-locks=0 not-130=0 orphans=0`, no ISSUE lines | PASS |
| TC-M1 | Manual | Ctrl-C during start | exit 130, stopped, no lock, no orphan | 5 human-style tries in a pty (50-150 ms): all `EXIT=130`, `stopped`, no `mcp.lock`, `pgrep` empty, no stack trace. M1a as written: 5/5 clean | PASS |
| TC-M2 | Manual | outlives its terminal | `running` same pid after close | pid 89966; window closed; `running pid 89966`; `stopped (pid 89966)` | PASS |
| TC-M3 | Manual | logs -f + Ctrl-C | streams, exit 0, no trace | marker and shutdown streamed; `EXIT=0`; no trace | PASS |
| TC-M4 | Manual | real Claude Code client | `/mcp` shows kinet with 14 tools; a tool call works | Not run: it needs approval inside Saurabh's Claude config and a model call on his account. Steps are under "For Saurabh" | BLOCKED |
| TC-M5 | Manual | README reads true | claims match behaviour | README unchanged since round 1 (`git diff 0710aa7 c2068cd -- README.md` is empty); claims match round-3 results. Linux is not verified | PASS |

**Pass rate (round 3): 107 / 108 = 99.1 %** (0 FAIL, 1 BLOCKED: TC-M4).

**Defects:**
1. BUG-1: fixed in `0710aa7`. TC-B1 re-verified (0/60).
2. BUG-2: **fixed in `c2068cd`, verified** (TC-B2 0/192 crashes and locks, TC-M1 clean). `bugs/BUG-2.md`.
3. BUG-3: **fixed in `c2068cd`, verified** (TC-6 `matches-exit=1`, no `*Sync(` call left in `src/cli/mcp.js`). `bugs/BUG-3.md`.
4. BUG-4: **test-case defect, corrected** in the TC-64 step (deterministic, 20/20). No product change. `bugs/BUG-4.md`.
5. Open defects: **none**. The only case not passed is TC-M4 (BLOCKED, Saurabh to run).

**Observations (unchanged):** `npm audit` on kinet's own lockfile reports 10 advisories (1 critical). `kinet_github_search` returns a readable 401 without `GITHUB_TOKEN`.

The "For Saurabh" steps below still apply to TC-M4 unchanged at `c2068cd`.

## For Saurabh

TC-M4 (real Claude Code client) is yours to run. It approves MCP servers in your Claude Code config and makes a model call on your account, so I did not run it. About 5 minutes:

1. Start from a throwaway project:
   ```bash
   mkdir -p /tmp/kinet-m4 && cd /tmp/kinet-m4 && git init -q -b main && printf '{"name":"m4","version":"1.0.0"}\n' > package.json
   node /Users/sjain/dev/personal/kinet/bin/kinet.js mcp start --port 47311
   cat > .mcp.json <<'JSON'
   {"mcpServers":{
     "kinet-stdio":{"command":"node","args":["/Users/sjain/dev/personal/kinet/bin/kinet.js","mcp"]},
     "kinet-sse":{"type":"sse","url":"http://127.0.0.1:47311/sse"}}}
   JSON
   ```
2. Run `claude` in `/tmp/kinet-m4`. When it asks, approve both `kinet-stdio` and `kinet-sse` for this project only.
3. Type `/mcp`. **Expect:** both servers `connected`, each with **14 tools** (`kinet_web_search` … `kinet_check_deps`).
4. Ask: "Use kinet-sse's kinet_git_status tool." **Expect:** `branch: main (no commits yet)` and an untracked list with `.mcp.json` and `package.json`. Then ask the same of `kinet-stdio`.
5. In another terminal: `cd /tmp/kinet-m4 && node /Users/sjain/dev/personal/kinet/bin/kinet.js mcp logs -n 5`. **Expect:** a `session open` line and `tool name=kinet_git_status … result=ok`, with no argument values.
6. Clean up: quit `claude`, then run `node /Users/sjain/dev/personal/kinet/bin/kinet.js mcp stop` (expect `stopped (pid …)`). Remove the project approvals with `claude mcp reset-project-choices` from `/tmp/kinet-m4`, then `rm -rf /tmp/kinet-m4`.

PASS if steps 3-5 match. Paste the `/mcp` screen and the log lines into this TSR under TC-M4.

## Verdict

ESCALATED — 107/108 (99.1%), full check green (lint, 121/121 tests, validate 0 violations), 0 open defects. The only case not passed is TC-M4 (real Claude Code client), which needs approval in Saurabh's Claude config and a model call on his account. Not merged to `develop` and not pushed. Merge after Saurabh runs the "For Saurabh" steps and TC-M4 passes.

## Not covered

1. Node 20 and Node 22. Only Node 24.15.0 is installed. `engines` says `>=20`, so these are **NOT RUN (environment)**.
2. Linux. The README says Linux is supported, and Linux bind and process semantics differ from macOS. Not run.
3. Windows. `kinet_run_script`/`kinet_check_deps` refuse by design, and the lifecycle commands are "best effort". Not run.
4. A real Claude Code client over SSE and stdio, end to end: TC-M4 is BLOCKED in all three rounds (approval in Saurabh's config, plus a model call). Steps are under "For Saurabh".
5. Laptop sleep/wake as a natural trigger for `unresponsive` (simulated with `SIGSTOP` in TC-101).
6. The rotation race in `logs -f` (review-5 finding 2, accepted as cosmetic).
7. A real-TTY Ctrl-C regression inside `npm test`. TC-B2 covers it at the release gate (pty, 192 tries), but the repo suite has no pty-driven test, so a future regression would only be caught by re-running TC-B2.
