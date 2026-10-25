APPROVED

# Review 5 — Developer stage (feature/mcp-cli-and-tools, 14 commits, `git diff develop...HEAD`)

Checked against 01-requirement.md, 03-design.md, 04-plan.md (including Deviations) and the CLAUDE.md enforced rules.

Evidence:
- `npm run lint` clean; `npm test` exit 0, `tests 100`, `pass 100`, about 4 s.
- Manual smoke in a scratch git repo: `start` (pid/port/url/log printed, exit 0) → `status` (`running`, exit 0) → `Host: evil.example` gets 403 → `logs -n 5` shows `start mode=daemon` and `listening` → `mcp foo` exits 1 naming `start, stop, status, logs` → `stop` (`stopped (pid N)`) → `status` (`stopped`, exit 1). No orphan process; `.kinet/run` holds only `.gitignore` and `mcp.log`.
- Key tests assert the AC rather than passing trivially: AC-9.3 (an unrelated live pid in `mcp.json` survives both `status` and `stop`), R3-3b (a stub server that ignores `/shutdown` is force-killed and its state cleared), AC-7.6 (the external IPv4 address gets ECONNREFUSED), AC-0.8a (`--output=<file>` refused and the file not created), AC-10.3 (no argument value or token in the log), AC-6.1 (real `StdioClientTransport`, no client `onerror`).
- Implementation matches 03 §2.7/§5 step by step. Both plan deviations are acceptable and keep every AC. No new production dependency. No `*Sync` calls in the new tool code. No untracked TODOs, debug output or dead code.

## Findings

1. Non-blocking. src/mcp/runstate.js:146-147 with src/cli/mcp.js:188-189 and :223-225. A daemon that is alive but answers `/health` slowly (the timeout is 1 s, for example after laptop sleep or a briefly blocked event loop) is classed as `stale`. `status` and `stop` then delete `mcp.json` and leave the real server running with no state. After that, `stop` says "not running" and `start` fails with "port in use", and only `kill` can recover it. This follows design D5 as written, and the tools are async, so the risk is low. Suggested follow-up: treat "pid alive + health timeout/connection error" as `unknown` (report it, keep the state). Only clear the state when the pid is dead or a different identity answers.
2. Non-blocking nit. src/cli/mcp.js:260. In `logs -f`, if a new `start` rotates the log and the new file grows past the old offset within one 250 ms poll, `curr.size < offset` is never true, so the start of the new log is skipped. This is cosmetic.

## Round 2 (security fixes)

Scope: the 9 commits `b9d0f8a..HEAD`, which respond to 06-security.md and review-6b.md. Verdict for the overall diff stays APPROVED.

Evidence:
- `npm run lint` is clean. `npm test` exits 0 with `tests 109`, `pass 109`. Afterwards there is no leftover `kinet.js mcp` process and no `.kinet/run` in the repo.
- Finding 1 (symlink, the only blocking item) is fixed correctly. `ensureRunDir` lstat-refuses a symlinked `.kinet` or `.kinet/run` and creates the dir 0700. `writeState` unlinks and then re-creates the tmp file with `wx`, so it never follows a link, and `rename` replaces a link rather than writing through it. The log open uses `O_NOFOLLOW`. The tests assert real effects: the victim file is unchanged, nothing is written into the link target for both the dir cases (this covers review-6b finding 3), mode is 0600/0700, ELOOP is raised on the log, and the CLI `start` refuses with exit 1.
- Finding 3 (pathspec) is fixed. `--literal-pathspecs` is applied once in `buildDiffArgs`, so it covers both the stat call and the patch call, and find-todos uses `:(literal)`. The tests reproduce the 06 exploit (`:(top)`, `:/other`, `:!x.txt` from a subdirectory never return `leaked-secret`). The find-todos test plants a file literally named `:(top)`, so the path exists and only the literal prefix protects it. The tests also record that paths are no longer glob-expanded (review-6b finding 4).
- Finding 4 (/sse) is fixed. Cross-site `Sec-Fetch-Site` gets 403 and a non-event-stream `Accept` gets 406. The test checks that neither request reaches session creation, and real SSE clients still pass in the lifecycle and routing tests.
- fsmonitor/textconv: all git calls now go through `runGit` (`-c core.fsmonitor=false`), and diff adds `--no-textconv`. The hostile-config test uses marker files outside the repo and asserts they are never created while the diff still works.
- EPIPE helper fix: it does not hide failures. stdin is `ignore` (immediate EOF, the same as the old empty `end('')`) unless input is given. The stdin `error` swallow only applies when input is given, and exit code, stdout and stderr are still resolved and asserted by every caller.
- README finding-2 wording and the SDK floor `^1.32.0` match 06's conditions.

### Round 2 findings

3. Non-blocking (Low, the same threat model as review-6b finding 1). src/mcp/tools/git-common.js:5 and src/mcp/tools/git-diff.js:35. A repo-configured `filter.<driver>.clean` command still runs. I reproduced it: a `.gitattributes` with `*.txt filter=evil` plus `.git/config filter.evil.clean=<script>`, and a modified `a.txt` with an old mtime. `kinet_git_status` and `kinet_git_diff` then executed the script (its marker file was created). Like fsmonitor, this needs a shipped `.git/config` (an archive, not a clone). The commit title only claims fsmonitor/textconv, so nothing it says is false, but the class is not closed. Fix options: (a) before running git, check `git config --local --get-regexp '^filter\..*\.(clean|process)$'` and refuse with a clear message if any match, plus a test that copies the hostile-config test with a clean filter; or (b) record it in 06 §6 as an accepted or deferred item, alongside a README line saying not to point the git tools at an untrusted checkout that ships its own `.git/`.
