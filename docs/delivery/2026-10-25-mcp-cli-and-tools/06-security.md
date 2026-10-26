# 06 — Security review: MCP lifecycle CLI + 5 solo-dev MCP tools

Stage: Security (6b) | Branch: `feature/mcp-cli-and-tools` (14 commits over `develop`) | Date: 2026-10-25
Inputs: `02-architecture.md`, `03-design.md`, `review-3.md`, `git diff develop...HEAD`, `npm audit --omit=dev`, GitHub advisory texts for the SDK, live probes.

## What I ran

- `npm test`: 100 pass, 0 fail.
- Foreground `kinet mcp --port 47391` in a scratch directory, probed with curl, then stopped:
  - `Host: evil.example` gave 403.
  - `/health` with no token gave 404.
  - `lsof` showed the listener on `127.0.0.1` only.
  - A browser-style no-cors `GET /sse` (image `Accept`, `Sec-Fetch-Site: cross-site`, no `Origin`) opened a session. See finding 4.
- `writeState()` against a scratch project with a planted symlink. See finding 1.
- `kinet_git_diff` with pathspec magic from a monorepo subdirectory. See finding 3.
- No `.kinet/run` state left behind in the repo. The scratch dirs are under the session scratchpad.

## Verified OK (no action)

1. Commands run through `spawn(..., { shell: false })`, so script names, refs and paths never reach a shell.
2. `--` comes before every path. Leading-dash values are refused for `ref`, `path` and `script`. A ref is checked with `rev-parse --verify <ref>^{commit}` before use. `git diff` uses `--no-ext-diff`.
3. `kinet_run_script` only runs keys of `package.json.scripts`, checked with `Object.hasOwn`, so `__proto__` and `x; rm -rf ~` are refused.
4. The token:
   - It is 32 random bytes, passed in the env rather than argv.
   - The daemon deletes it from `process.env` at boot, and `safeExec` strips it from child envs (tested).
   - The compare is `timingSafeEqual` with a length pre-check. Only the length leaks, and that is a fixed 64.
   - It grants `/health` and `/shutdown` only.
   - `mcp.json`, `mcp.lock` and `mcp.log` are created with mode 0600.
5. Host allowlist plus Origin allowlist block DNS rebinding and cross-site POSTs. The SDK also rejects any POST to `/messages` whose type is not `application/json`, so a simple form or `text/plain` POST cannot deliver JSON-RPC. A JSON POST triggers a CORS preflight, which gets no CORS headers.
6. Logs never contain argument values (tested with `SECRET_ARG_123`) or tool error text. `npm audit` output is reduced to name, severity, direct and fixAvailable before it is returned.
7. DoS bounds:
   - Every exec has a timeout: 10-30 s for git, 60 s for npm, at most 600 s for scripts.
   - Output is capped, and in-memory collectors hold at most about 2x the cap.
   - On timeout and shutdown, the whole process group is killed.
   - Sessions are capped at 16, and the log at 10 MB per run.
8. No new production dependency. `@eslint/js` is a dev dependency.
9. Behaviour improvement: `--port` used to listen on all interfaces. It now binds to `127.0.0.1` only.

## Findings

### 1. Run-state writes follow symlinks: a cloned repo can make `kinet mcp start` overwrite any file you own — BLOCKING
- **What's wrong:**
  - `writeState()` (`src/mcp/runstate.js`) calls `writeFile(tmp, ..., { mode: 0o600 })` and then `rename`. `writeFile` follows a symlink at `.kinet/run/mcp.json.tmp`, and `mode` only applies when the file is created.
  - `ensureRunDir()` also accepts `.kinet` or `.kinet/run` being symlinks, and it creates the dir with the default 0755.
- **Exploit:**
  - A malicious repo commits `.kinet/run/mcp.json.tmp -> ../../../.zshrc`. Any relative or absolute target works.
  - The victim clones it and runs `kinet mcp start`. The target file is truncated and replaced with `{"pid":…,"token":"<64 hex>",…}`, keeping the target's existing permissions (e.g. 0644).
  - The rename then leaves `mcp.json` as a symlink to that file.
  - Reproduced in the scratchpad: the victim file's content was replaced with the JSON.
  - Impact: you lose an arbitrary file you own, and the daemon token ends up in a file that may be world-readable. kinet-ai is a published CLI, so "runs it in a repo they didn't write" is a normal use.
- **Severity:** Medium.
- **Fix (small):**
  - In `ensureRunDir`, `lstat` `.kinet` and `.kinet/run` and refuse if either is a symlink. Create the run dir with `mkdir(..., { recursive: true, mode: 0o700 })`.
  - In `writeState`, `unlink(tmp)` (ignore ENOENT), then `open(tmp, 'wx', 0o600)`. O_EXCL never follows a symlink. Write, close, then `rename`.
  - Open the log with `fs.constants.O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW`.
  - Add one test: plant a `mcp.json.tmp` symlink, call `writeState`, and assert that the link target is unchanged and the call refuses or replaces the link.

### 2. TBC-2 / review-3 #4: `/sse` and `/messages` are not token-gated — NON-BLOCKING (accepted for v1 with conditions)
- **What's wrong:** while the daemon runs, any local process or **any other local user account** can connect to `127.0.0.1:7345` and call every tool as the daemon owner.
- **Exploit:** on a shared Mac or Linux box, user `bob` runs an MCP client against `http://127.0.0.1:7345/sse`. Bob can then:
  - Call `kinet_run_script` to run `start`, `test`, `deploy` or any other script in Saurabh's `package.json`, as Saurabh, with Saurabh's environment (cloud credentials included).
  - Call `kinet_git_diff scope=staged` to read staged changes, including any secrets.
  - Bob cannot inject arbitrary commands unless he can also write `package.json`.
  - Browsers are blocked (finding 4 is DoS only). Existing sessions cannot be hijacked without their random UUID.
- **Severity:** Low on a single-user machine, because same-user processes already have equal power. High on a shared host.
- **Decision:** acceptable for v1, because auth is Later item 7, the target is Saurabh's single-user Mac, and the README warns about it. Conditions before merge:
  - In README "Security notes", delete "(Wording pending Security sign-off.)".
  - Change the README wording to "any other local user account or process".
- **Fix (next release):** require `Authorization: Bearer <token>` on `/sse` and `/messages`, reusing `tokenMatches`, and print a client config snippet with the header from `start`. Do this before any `--host` option ships.

### 3. Git pathspec magic bypasses `resolveInsideProject` — NON-BLOCKING
- **What's wrong:** git interprets `:(top)`, `:/x`, `:!x` and similar even after `--`. `resolveInsideProject` sees `:(top)` as a harmless relative name that does not exist, and passes it through. That defeats AC-0.8c for a cwd that is a subdirectory of a larger repo.
- **Exploit:**
  - Repro: in a monorepo, with cwd `app/`, call `kinet_git_diff {path:":(top)"}`, `":/other"` or `":!x.txt"`.
  - Each one returned the diff of `other/secret.txt`, which is outside the project dir.
  - Exposure is bounded: a bare `git diff` with no path already shows the whole repo. `kinet_find_todos` is mostly protected by its `stat` check, but it would be exposed if a file literally named `:(top)` existed.
- **Severity:** Low.
- **Fix:**
  - Run `git --literal-pathspecs diff …` in `buildDiffArgs`.
  - In `buildGrepArgs`, prefix the user path with `:(literal)` and keep the exclude magic on its own element.
  - Add a test that `path: ':(top)'` does not reach outside cwd.

### 4. A cross-site page can fill all 16 SSE slots — NON-BLOCKING
- **What's wrong:** a no-cors subresource GET (`<img src="http://127.0.0.1:7345/sse">`) carries no `Origin` and a valid `Host`, so it passes the guard and opens a session. It also builds a `Server` per request. Confirmed live with curl using browser-like headers.
- **Exploit:** a web page embeds 16 such tags. While the tab is open, your real MCP client gets `503 Too many sessions`. The page cannot read the `sessionId`, so it cannot call tools.
- **Severity:** Low (DoS only).
- **Fix:**
  - On `GET /sse`, require `Accept` to include `text/event-stream`.
  - Reject any request whose `Sec-Fetch-Site` header is present and is not `same-origin` or `none`.
  - Both checks are two lines in `route()`, plus a test.

### 5. `@modelcontextprotocol/sdk` 1.29.0 audit advisories — NON-BLOCKING (raising the floor is recommended, not required now)
- **Verified:** `npm audit --omit=dev` shows 11 findings (1 critical, 8 high, 2 moderate). The direct SDK entry is high and covers 5 advisories, all fixed in 1.32.0. The latest is 1.32.2.
- **Do they apply to kinet's code paths?** Only one is reachable:
  - GHSA-46jr-4wx8-v453 (memory exhaustion on a large JSON POST): **reachable** on `/messages`, but only by a local process, and that process can already run scripts (finding 2). Upgrading alone changes nothing: the fix is an opt-in `McpServer` option, and kinet uses the low-level `Server`.
  - GHSA-22jm-h49p-29qw (taskStore): not used. `grep -ri taskstore src` finds nothing.
  - GHSA-6qxp-vccf-f47h and GHSA-6prh-2h8m-c8cw (OAuth client, client redirects): kinet uses no OAuth. The SDK client is used only in tests, against localhost.
  - GHSA-rvq5-wwqv-78pq (`requireBearerAuth` audience): not used.
- **Context:**
  - `package-lock.json` is **not tracked**, so a fresh `npm i kinet-ai` already resolves `^1.12.0` to 1.32.2. The 1.29.0 copy is only this checkout's `node_modules`.
  - The other audit hits (hono, @hono/node-server, express-family, fast-uri, ip-address) are SDK transitive dependencies on code paths kinet never imports.
  - js-yaml and zod are direct dependencies but predate this change.
- **Fix:**
  - Change the range to `"@modelcontextprotocol/sdk": "^1.32.0"` (this branch or the next), run `npm install`, and re-run the full suite. `SSEServerTransport` is deprecated, so confirm it still exports in 1.32.x; the routing tests cover this.
  - Separately, decide whether to commit `package-lock.json` for reproducible dev and CI. This is pre-existing.

### 6. Smaller hardening items — NON-BLOCKING
- (a) `kinet_find_todos` without git (`scanWithoutGit`): `glob` with `nodir` matches symlinked *files*, and `readFile` follows them, so a link to `~/.aws/credentials` would have its marker lines (at most 200 chars each) returned. Low. Fix: `lstat` and skip symlinks, or realpath-check against cwd.
- (b) Secrets in tool output are by design: a tracked or staged `.env` appears in `kinet_git_diff`. This is the same as running git yourself, and the existing `env/*` rules already cover it. No action beyond finding 2.
- (c) The orphaned-script-on-SIGKILL limitation is documented in the README and accepted. `safeExec` children are their own process groups, so a group kill on the daemon would not reach them anyway.
- (d) Accepted risk [ASSUMPTION] (review-5 round 2, finding 3): a repo-local `filter.<name>.clean` in `.git/config` still runs when kinet calls `git status`/`git diff`. Plain `git status`, or a git-aware shell prompt in that folder, runs the same script, so kinet adds no new exposure. Mitigations in place: `-c core.fsmonitor=false` on every git call; `--no-ext-diff` and `--no-textconv` on diff (tested). The README tells users not to run the git tools in a folder whose `.git` they don't trust.

## Verdict

**CHANGES REQUIRED: one blocking item.**

1. Fix finding 1 (symlink-safe run dir and state writes, plus a test) and make the finding 2 README wording change.
2. After that, Security approves without needing another design review.
3. Findings 3-6 can go into this branch if cheap (3 and 4 are a few lines each) or into the next slice. Raising the SDK floor to `^1.32.0` is recommended but not required for this merge.
4. TBC-2 (D8 Host/Origin guard): **confirmed.** The guard as built is correct and sufficient against DNS rebinding.

## Re-check (fix commits `b9d0f8a..6b50b10`)

I re-ran the repros against the new code in scratch dirs, then deleted the dirs. The repo has no `.kinet/run` and no server is still listening.

1. **Finding 1: FIXED.**
   - A planted `.kinet/run/mcp.json.tmp` symlink no longer touches its target. The victim file still reads `IMPORTANT`, the link is replaced, and the new `mcp.json` is mode 0600.
   - A symlinked `.kinet/run` makes `kinet mcp start` exit 1 with "refusing to use … it is a symlink", and nothing is written to the link target.
   - A symlink planted at `mcp.log` fails to open with `ELOOP` (`O_NOFOLLOW`).
   - Residual, non-blocking: `mode: 0o700` only applies when the run dir is created. A pre-existing `.kinet/run` stays 0755. The files inside are 0600, so the exposure is limited to file names.
2. **Finding 2: FIXED.** The README now says "any other local user account or process … as you", and the "pending sign-off" note is gone. Token-gating is committed as a prerequisite for `--host`.
3. **Finding 3: FIXED.**
   - From a monorepo subdirectory, `:(top)`, `:(top)other`, `:/other` and `:!x.txt` all return "No changes". Before the fix, each one leaked `other/secret.txt`.
   - `git diff` uses `--literal-pathspecs`, and `git grep` uses a `:(literal)` prefix.
   - A bare call with no path still shows the whole repo. That is git's normal behaviour and was accepted in the original review.
4. **Finding 4: FIXED (live check).**
   - A cross-site `Sec-Fetch-Site` request gets 403.
   - An image `Accept` with no fetch metadata gets 406.
   - `Accept: text/event-stream` still opens a session.
5. **Finding 5: FIXED.** The range is now `^1.32.0`. `npm audit --omit=dev` no longer lists `@modelcontextprotocol/sdk`. The 10 remaining hits are transitive or pre-existing, as noted above.
6. **review-6b #1 (fsmonitor/textconv): FIXED by inspection.** Every git call now goes through `runGit` with `-c core.fsmonitor=false`, diff uses `--no-textconv`, and `git-hostile-config.test.js` covers it.
7. **Finding 6:** deferred, and the deferral is recorded in `04-plan.md`. It is acceptable as non-blocking.

`npm test`: 109 pass, 0 fail.

**Final verdict: APPROVED.** No blocking findings remain.
