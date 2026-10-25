# 03 — Solution Design: MCP lifecycle CLI + 5 solo-dev MCP tools

Stage: Solution Designer | Branch: `feature/mcp-cli-and-tools` | Date: 2026-10-25
Inputs: `01-requirement.md`, `02-architecture.md` (ADR-001), `review-1.md`, `review-2.md`, repo `CLAUDE.md`, `bin/kinet.js`, `src/mcp/server.js`, `src/rules/validators/{common,node}.js`, `src/rules/engine.js`, `src/utils/*`, `package.json`, installed `@modelcontextprotocol/sdk` 1.29.0, `commander` 13.1.0, `eslint` 9.39.4, git 2.54.0, Node 24.15 on darwin.

This document is the build contract. If something here conflicts with 02, 02's decisions still stand. Where 03 adds detail or corrects a command (the T3 pathspec, §4.3), the reason is given.

---

## 0. Things I verified on this Mac (they change the spec)

1. **The T3 grep command (review-2 finding 1).** Tested against a temp repo with git 2.54.0:
   - `git grep -E "\b(TODO|FIXME)\b"` exits 1 with no output. Confirmed broken.
   - `git grep -n -I --untracked -w -E "TODO|FIXME|HACK|XXX"` works. It matches `a TODO x`, `HACK: z` and `XXX`. It skips `myTODOs`, skips a file containing a NUL byte (`-I`), and skips gitignored files.
   - **Correction to review-2:** `':(exclude)node_modules'` only excludes the **top-level** `node_modules/`. A nested `src/node_modules/x/i.js` was still matched. `':(exclude,glob)**/node_modules/**'` excludes both the top-level and the nested ones. The spec uses the glob form.
   - Exit codes: 0 when there are matches, 1 when there are none, 128 for an error such as not being a repo.
   - When cwd is a subdirectory of the repo, paths come back relative to cwd. That is what we want.
   - `-z` gives `path\0line\0text\n`. We parse that, so a `:` in a filename cannot break parsing.
2. **T1 commands.**
   - `git --no-optional-locks status --porcelain=v2 --branch` prints `# branch.head (detached)` for a detached HEAD and `# branch.oid (initial)` before the first commit.
   - `git log` exits 128 (`does not have any commits yet`) on an empty repo. This must be handled.
3. **Test script.** The test script is the bare `node --test` (review-3 finding 1). Node finds `**/*.test.js` itself, skips `node_modules`, and does not load `src/test-support/helpers.js`. Verified on Node 20, 22, 24 and 26. A quoted glob argument would fail on Node 20, which `engines` still supports.
4. **Lint today.** Running `eslint` with `@eslint/js` recommended over `src/` and `bin/` gives 11 errors: 10 unused imports and 1 empty `catch {}`. The plan for these is in §8.
5. **`kinet validate` baseline on this repo:** 0 violations, 29 warnings (25 `no-console-log-prod`, 4 `no-todo-without-ticket`). New code must add **0 violations and at most 1 warning** (§3).
6. **SDK 1.29.0.** `InMemoryTransport.createLinkedPair()`, `StdioClientTransport({ stderr: 'pipe' })` and `SSEClientTransport` are all exported. Tests use them. They are not new dependencies.

---

## 1. Files

### New

| File | Responsibility |
|------|----------------|
| `src/rules/patterns.js` | The single source of the ticket pattern and the marker list (§3) |
| `src/utils/exec.js` | `safeExec`, `capText`, process-group tracking and killing |
| `src/utils/args.js` | Argument hardening for tools, plus commander parsers for the port and line count |
| `src/mcp/log.js` | Timestamped stderr logger with a size cap |
| `src/mcp/http.js` | HTTP request handler: guard, `/sse`, `/messages`, `/health`, `/shutdown`, top-level try/catch |
| `src/mcp/runstate.js` | CLI side: run dir, state file, lock, health probe, identity check |
| `src/mcp/tools/git-status.js` | T1 |
| `src/mcp/tools/git-diff.js` | T2 |
| `src/mcp/tools/find-todos.js` | T3 |
| `src/mcp/tools/run-script.js` | T4 |
| `src/mcp/tools/check-deps.js` | T5 |
| `src/mcp/tools/local.js` | Registry: `export const localTools = [gitStatus, gitDiff, findTodos, runScript, checkDeps]` |
| `src/cli/mcp.js` | `runMcpStart`, `runMcpStop`, `runMcpStatus`, `runMcpLogs` |
| `eslint.config.js` | Minimal flat config (§8) |
| Tests: see §9 | |

### Touched

| File | Change |
|------|--------|
| `src/mcp/server.js` | Split into `createKinetServer()` + `startMcpServer()`. Register the local tools, log tool calls, wire HTTP via `http.js`, add shutdown. The 9 existing `case`s and their definitions are **not changed**. |
| `src/rules/validators/common.js` | `no-todo-without-ticket` builds its regex from `patterns.js` (§3). Nothing else changes. |
| `bin/kinet.js` | `mcp` becomes a parent command with 4 subcommands (§5). Add `enablePositionalOptions()`. |
| `package.json` | Quoted test glob, `lint` script, `@eslint/js` devDependency, `files` negations (§8). |
| `README.md` | MCP Tools table (14 rows), CLI section, `--port` now binds to 127.0.0.1, default port 7345, Windows note. |
| 6 files with unused imports | Delete the unused imports only (§8). |

---

## 2. Module contracts (exported signatures)

### 2.1 `src/utils/exec.js`

```js
export const OUTPUT_CAP = 20000;
export async function safeExec(cmd, args, { cwd, timeoutMs = 120000, maxChars = OUTPUT_CAP, keep = 'head', env } = {})
  // → { code: number|null, signal: string|null, stdout, stderr, combined, timedOut: boolean, truncated: boolean, durationMs }
export function capText(text, maxChars = OUTPUT_CAP, keep = 'head') // → string
export function killActiveProcessGroups(signal = 'SIGTERM')          // → number of groups signalled (sync)
```

Behaviour:
- Uses `spawn(cmd, args, { cwd, shell: false, stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32', windowsHide: true, env: childEnv })`.
- `childEnv = { ...(env ?? process.env) }`, then `delete childEnv.KINET_MCP_TOKEN`. This is unconditional (review-2 finding 4).
- While a child runs, its pid is in a module-level `Set`. It is removed on `close`.
- `killActiveProcessGroups` calls `process.kill(-pid, signal)` for each pid in the set (`child.kill` on win32) and ignores `ESRCH`. It is synchronous on purpose, so it can run inside `process.on('exit')`.
- Timeout: send `SIGTERM` to the group, then `SIGKILL` 2 s later, and set `timedOut = true`.
- Output: three collectors (stdout, stderr, combined in arrival order), using `setEncoding('utf8')`.
  - `keep:'head'` keeps the first `maxChars`.
  - `keep:'tail'` keeps a rolling last `maxChars`, trimmed whenever it grows past `2 × maxChars`.
  - The collectors count the newlines they drop.
- `capText` and the collectors use the same truncation text:
  - head: append `\n[truncated: N more lines]`
  - tail: prepend `[truncated: N earlier lines]\n`
  - `N` = the number of dropped newlines, plus 1 if the dropped part does not end with a newline.
- The promise resolves on `close` for any exit code. It rejects only on a spawn `error`. `ENOENT` becomes `new Error(\`${cmd} not found on PATH\`)`.

### 2.2 `src/utils/args.js`

```js
export function assertNoLeadingDash(value, name)        // throws Error(`Refusing ${name} "${value}": values starting with "-" are not allowed.`)
export async function resolveInsideProject(cwd, p)      // → relative path ('.' for the root); throws Error(`Refusing path "${p}": it is outside the project directory.`)
export function parsePort(value)                        // commander parser → int 1..65535, else throws InvalidArgumentError('must be an integer 1-65535')
export function parsePositiveInt(value)                 // commander parser → int >= 1, else InvalidArgumentError
```

`resolveInsideProject` does the following:
1. Calls `assertNoLeadingDash(p, 'path')`.
2. Computes `abs = path.resolve(cwd, p)` and refuses if `path.relative(cwd, abs)` starts with `..` or is absolute.
3. If `abs` exists, repeats the check with `realpath(abs)` against `realpath(cwd)`. This matters on macOS, where temp directories under `/var` are `/private/var`, and it stops symlink escapes.
4. Returns `path.relative(realCwd, realAbs) || '.'`.

Integer strings only, matched by `/^\d+$/` before `Number()`, so `"80abc"` is refused.

### 2.3 `src/rules/patterns.js`: see §3.

### 2.4 `src/mcp/log.js`

```js
export function createLogger({ stream = process.stderr, capBytes = 10 * 1024 * 1024 } = {})
  // → { info(msg), warn(msg), error(msg), tool(name, ms, ok) }
```

- Line format: `<ISO timestamp> <LEVEL> <message>\n`.
- After `capBytes` bytes have been written, it writes one line: `WARN log cap reached; tool-call lines suppressed`. From then on, `info` and `tool` are dropped, and `error` lines plus the `shutdown` line (logged via `warn`) still go through.

### 2.5 `src/mcp/http.js`

```js
export function isAllowedHost(host, port)       // host === `127.0.0.1:${port}` || host === `localhost:${port}`
export function isAllowedOrigin(origin, port)   // origin undefined → true; else one of http://127.0.0.1:<port>, http://localhost:<port>
export function tokenMatches(given, expected)   // false if either is missing or the lengths differ; else crypto.timingSafeEqual
export function createRequestHandler({ port, token, createSessionServer, log, healthInfo, requestShutdown, maxSessions = 16 })
  // → { handler: async (req, res) => void, sessions: Map<string, SSEServerTransport>, closeAllSessions: () => Promise<void> }
```
Routes and the auth contract are in §6.

### 2.6 `src/mcp/server.js`

```js
export function createKinetServer({ log })   // → SDK Server with tools/list (14) + tools/call
export async function startMcpServer({ port } = {})
export const TOOL_DEFINITIONS                // [...existing9, ...localTools.map(t => t.definition)]; exported for tests
```

- `createKinetServer`:
  - Keeps today's `CallTool` body.
  - Before the existing `dispatch`, it looks the tool up in `localByName: Map<name, run>`.
  - Local tools get `ctx = { cwd, config, kinetDir, log }`.
  - For local tools, the result text goes through `capText(text, OUTPUT_CAP)` as a final guard (AC-0.4).
  - Every tool call, existing or new, is wrapped as: `t0 = performance.now()` → call → `log.tool(name, ms, ok)`. Argument values and error messages are never logged.
- `startMcpServer`:
  1. Reads `KINET_MCP_TOKEN` once. If it is set and does not match `/^[0-9a-f]{64}$/`, write `Error: KINET_MCP_TOKEN must be 64 hex characters` to stderr and set `process.exitCode = 1`, then return. Otherwise store it in a local and `delete process.env.KINET_MCP_TOKEN`.
  2. Reads the version from `package.json` with `fs/promises`.
  3. Picks the mode: `stdio` (no port), `http` (port, no token), or `daemon` (port and token).
  4. Logs `INFO start mode=<m> port=<p|-> pid=<pid> cwd=<realpath> version=<v>`.
  5. Registers `process.on('exit', () => killActiveProcessGroups('SIGKILL'))`. This is review-2 finding 4: it also covers stdio mode when the client goes away.
  6. Registers `SIGTERM` and `SIGINT` → `shutdown(<signal>)`.
  7. HTTP modes: `http.createServer(handler)`, then `listen(port, '127.0.0.1')`.
     - On `EADDRINUSE`: `log.error(\`port ${port} is in use\`)`, then `process.exit(3)`.
     - On success: `log.info(\`listening http://127.0.0.1:${port}/sse\`)`.
  8. stdio mode: the same as today (`StdioServerTransport`). Nothing is written to stdout except protocol messages.
- `shutdown(reason)`, internal and idempotent:
  1. `log.warn(\`shutdown reason=${reason}\`)`
  2. `killActiveProcessGroups('SIGTERM')`
  3. `await closeAllSessions()`
  4. `httpServer.close()` and `httpServer.closeAllConnections()`
  5. A `setTimeout(() => process.exit(0), 1000).unref()` fallback. `process.exit(0)` runs in the `close` callback.

### 2.7 `src/mcp/runstate.js` (used by the CLI only)

```js
export const DEFAULT_PORT = 7345;
export function runPaths(cwd)        // → { dir, state, tmp, lock, log, prevLog, gitignore }  (all absolute, under <cwd>/.kinet/run/)
export async function ensureRunDir(cwd)          // mkdir -p; writes .gitignore '*\n' if missing
export async function readState(cwd)             // → object | null (missing or unparseable → null)
export async function writeState(cwd, state)     // tmp file mode 0o600, then rename
export async function clearState(cwd)            // unlink, ignore ENOENT
export async function acquireLock(cwd)           // → release(): Promise<void>; throws LockHeldError { pid }
export function isPidAlive(pid)                  // kill(pid,0): ESRCH → false, EPERM → true
export async function probeHealth(port, token, timeoutMs = 1000) // → { status, body? } | { error: code }
export async function checkIdentity(cwd)         // → { state: 'stopped' } | { state: 'stale', reason } | { state: 'unresponsive', info } | { state: 'running', info: { ...stateFile, uptimeMs } }
export class LockHeldError extends Error {}
```

`checkIdentity` follows D5 exactly. It is **pure**: it never deletes anything. Callers clear stale state, which keeps the AC-8.4 test simple. `probeHealth` uses the global `fetch` with `AbortSignal.timeout`.

### 2.8 `src/cli/mcp.js`

```js
export async function runMcpStart({ port })            // sets process.exitCode
export async function runMcpStop()
export async function runMcpStatus()
export async function runMcpLogs({ lines = 50, follow = false })
export function abortStart(child, release)             // sync kill of child group + fire-and-forget release; exported for test
export function formatUptime(ms)                       // '45s' | '3m 12s' | '2h 5m' | '1d 3h'
export function lastLines(text, n)                     // → string
```

All output goes through `process.stdout.write` / `process.stderr.write`, not `console.log`. This avoids new `no-console-log-prod` warnings (§0.5). Errors go to stderr with the prefix `Error: `.

### 2.9 Tool module shape (all 5)

```js
export const definition = { name, description, inputSchema };
export async function run(args = {}, ctx) // → string | object (server.js JSON-stringifies objects, as today)
```

Conventions:
- **Bad input** (refused arguments): `throw new Error(msg)`. The existing handler returns `Error: msg` with `isError: true`.
- **Environment conditions** (not a git repo, no `package.json`, no changes, script already running, Windows): return plain text, `isError: false`. This matches the existing `'KINET not initialised.'` style.
- Numeric arguments are clamped, not refused: non-numbers fall back to the default, and values are clamped to `[min, max]`.

T2 and T3 also export pure argument builders for AC-0.8b (see §4).

---

## 3. Shared ticket pattern (AC-3.2, review-1 note 2)

`src/rules/patterns.js`:

```js
export const TICKET_REF_SOURCE = String.raw`\s*\[#?\w+[-_]\d+\]`;
export const TODO_MARKERS = Object.freeze(['TODO', 'FIXME', 'HACK', 'XXX']);
export function missingTicketPattern(marker) {
  return new RegExp(`${marker}(?!${TICKET_REF_SOURCE})`, 'i');
}
```

- `common.js` adds a module-scope `const TODO_WITHOUT_TICKET = missingTicketPattern(TODO_MARKERS[0]);` and the loop uses `TODO_WITHOUT_TICKET.test(lines[i])`. There is no `g` flag, so `lastIndex` holds no state.
  - `missingTicketPattern('TODO').source` is character-for-character the old literal's source, and the flags are both `i`. A test asserts this.
- T3 sets `hasTicket = !foundMarkers.some(m => missingTicketPattern(m).test(line))`, where `foundMarkers = line.match(/\b(TODO|FIXME|HACK|XXX)\b/g)` (built from `TODO_MARKERS`).
  - For a line whose only marker is `TODO`, `hasTicket === !validatorRegex.test(line)` by construction. So the two can never drift: there is one pattern source and one constructor.
- **Known, accepted difference:** T3 finds markers in **uppercase, as whole words** (`git grep -w`, case-sensitive). The validator also flags lowercase `todo`. A lowercase-only `// todo x` line is flagged by `kinet validate` but not listed by T3. When a line is listed by both, they always agree on whether it has a ticket. This goes in the T3 description and the README. The reason: `-i` would make `hack`/`xxx` in prose noisy.
- **No new validate warnings from literals:**
  - `patterns.js` holds the only new literal `'TODO'`, which is 1 new warning and unavoidable.
  - `find-todos.js` builds its description and grep pattern from `TODO_MARKERS`.
  - Tests build their fixture strings from `TODO_MARKERS[0]`, never a literal.

---

## 4. The 5 tools

The common preamble for T1 and T2 runs `safeExec('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeoutMs: 10000 })`. If `code !== 0` or stdout is not `true`, the tool returns:
`Not a git repository: <cwd>. <tool name> needs a git work tree.`
Any other unexpected git failure returns `git <subcommand> failed (exit <code>): <first 500 chars of stderr>`.

### 4.1 T1 `kinet_git_status`

```json
{ "type": "object", "properties": {
    "commits": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10, "description": "Number of recent commits to include" } } }
```
- Description: "Show the current git branch, upstream ahead/behind, staged/unstaged/untracked files and recent commits. Read-only."
- These two run in parallel (timeout 10 s each):
  - `git --no-optional-locks status --porcelain=v2 --branch` (review-2 finding 5)
  - `git --no-optional-locks log -n<k> --format=%h%x1f%an%x1f%aI%x1f%s`
- Parsing:
  - `# branch.head`: `(detached)` means detached.
  - `# branch.oid`: `(initial)` means no commits.
  - `# branch.upstream`, `# branch.ab +A -B`.
  - `1 XY …` (8 fields, then the path) and `2 XY …` (9 fields, then `path\torig`): X ≠ `.` → staged, Y ≠ `.` → unstaged.
  - `u …` → conflicted.
  - `? path` → untracked.
- If `log` exits non-zero while the oid is `(initial)`, show `none (no commits yet)`.
- Output (text):
```
branch: feature/x (upstream origin/feature/x, ahead 1, behind 0)
staged (1):
  M src/a.js
unstaged (1):
  M README.md
untracked (1):
  docs/
conflicted: none
recent commits (2):
  8210470  2026-10-25T19:29:29+11:00  Saurabh Jain  feat: x
  1a2b3c4  2026-10-24T10:00:00+11:00  Saurabh Jain  fix: y
(paths are relative to the repository root)
```
- Other branch-line forms: `branch: (detached HEAD at 8210470)`, `branch: master (no upstream)`, `branch: master (no commits yet)`. An empty list prints as `staged: none`.
- For renames the line is `R  new <- old`.

### 4.2 T2 `kinet_git_diff`

```json
{ "type": "object", "properties": {
    "scope": { "type": "string", "enum": ["working", "staged", "ref"], "default": "working" },
    "ref":   { "type": "string", "description": "Required when scope is 'ref'. Diffs ref...HEAD (e.g. 'main')." },
    "path":  { "type": "string", "description": "Limit to a file or directory inside the project" } } }
```
- Description: "Show a diff stat and patch for unstaged, staged, or ref...HEAD changes. Read-only."
- Exported pure helper: `export function buildDiffArgs({ scope, ref, path }, { stat })`. It returns:
  - `['diff', '--no-color', '--no-ext-diff', ...scopeArgs, ...(stat ? ['--stat'] : []), '--', ...(path ? [path] : [])]`
  - where `scopeArgs` is `[]`, `['--cached']`, or `[\`${ref}...HEAD\`]`.
- Validation, in this order. Each refusal throws.
  1. An invalid `scope` → `scope must be one of: working, staged, ref`.
  2. If `ref` is provided, call `assertNoLeadingDash(ref, 'ref')`. This applies in every scope.
  3. `scope === 'ref'` with no `ref` → `ref is required when scope is "ref"`.
  4. If `path` is provided, run it through `resolveInsideProject(cwd, path)`. The path does not have to exist, because deleted files are valid diff paths.
- Ref check: `git rev-parse --verify --quiet <ref>^{commit}`. If `code !== 0`, return the text `Unknown ref "<ref>": not a commit in this repository.` (AC-2.4). A literal like `main; rm -rf ~` ends up here and is never executed (AC-0.5).
- Then run stat (`maxChars 4000`) followed by the patch (`maxChars 18000`, `keep 'head'`), with a 30 s timeout each.
- An empty stat returns `No changes (<scope label>).`. For `working`, it adds ` Untracked files are not shown; see kinet_git_status.` (AC-2.5).
- Output: `diff: <label>\n\n<stat>\n\n<patch>`. Labels:
  - `working tree vs index (unstaged)`
  - `index vs HEAD (staged)`
  - `<ref>...HEAD`

### 4.3 T3 `kinet_find_todos`

```json
{ "type": "object", "properties": {
    "path": { "type": "string", "description": "Subdirectory or file to scan (default: project root)" },
    "missingTicketOnly": { "type": "boolean", "default": false } } }
```
- Description, built from `TODO_MARKERS`: "List TODO/FIXME/HACK/XXX markers (uppercase, whole word) with file and line, flagging those without a ticket reference like [PROJ-123] (same rule as kinet validate)."
- If `path` is given, run it through `resolveInsideProject`. It must exist (`fs/promises.stat`), otherwise return `Path not found: <path>`.
- Exported pure helper: `export function buildGrepArgs(path = '.')`. It returns:
  - `['grep', '-z', '-n', '-I', '--untracked', '-w', '-E', TODO_MARKERS.join('|'), '--', path, ':(exclude,glob)**/node_modules/**']`
- Git repo (same check as T1): `safeExec('git', buildGrepArgs(rel), { maxChars: 2_000_000, timeoutMs: 30000 })`.
  - Exit 1 means zero results.
  - Exit greater than 1 → `git grep failed …`.
  - Parse each `\n`-separated record by splitting on the first two `\0`.
- Not a git repo:
  - `glob('**/*', { cwd: <abs base>, nodir: true, dot: true, ignore: ['**/node_modules/**', '**/.git/**'] })`, then read each file one at a time with `fs/promises`.
  - Skip files over 1 MB (`stat`) and files with a `\0` in the first 8 KB.
  - Scan the lines with the JS regex `/\b(TODO|FIXME|HACK|XXX)\b/`. JS `\b` uses the same word characters as git `-w`.
  - Paths are relative to cwd.
- Each result: `{ file, line, marker, hasTicket, text }`.
  - `marker` is the first found marker.
  - `text` is the trimmed line, cut to 200 characters.
- `missingTicketOnly` filters the results. The counts are always computed over all matches.
- Output (object): `{ "total": 12, "missingTicket": 5, "results": [ … ], "truncated": "[truncated: N more results]" }`.
  - `truncated` is present only when needed.
  - Results are added while the running sum of `JSON.stringify(entry).length` stays at or below 18000.
- **Not a regression of AC-3.3:** `.git/` is never searched by `git grep`. `node_modules` is excluded at any depth whether or not it is gitignored, using the glob pathspec verified in §0.1.

### 4.4 T4 `kinet_run_script`

```json
{ "type": "object", "properties": {
    "script": { "type": "string", "description": "Name of a script in package.json. Omit to list scripts." },
    "timeoutSeconds": { "type": "integer", "minimum": 1, "maximum": 600, "default": 120 } } }
```
- Description (AC-4.6): "Run an npm script declared in this project's package.json (e.g. test, lint, build) and return its exit code and output. WARNING: this executes project code on your machine. Call with no script to list the available scripts."
- Order of checks:
  1. `process.platform === 'win32'` → `kinet_run_script is not supported on Windows in v1.`
  2. Read `package.json` with `fs/promises`. Missing → `No package.json in <cwd>; kinet_run_script needs an npm project.` Bad JSON → `package.json could not be parsed: <message>`. No `scripts` or empty → `package.json defines no scripts.`
  3. No `script` → list the scripts (AC-4.1).
  4. `assertNoLeadingDash(script, 'script')`. If `!Object.hasOwn(scripts, script)`, throw `Unknown script "<x>". Valid scripts: a, b, c` (AC-4.2). `hasOwn` blocks `__proto__` and `toString`.
  5. A module-level `running` name is set → return `A script is already running (<name>); wait for it to finish.`
- Run `safeExec('npm', ['run', script], { cwd, timeoutMs: s*1000, keep: 'tail', maxChars: 18000, env: { ...process.env, CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' } })`. Reset `running` in `finally`.
- List output:
```
scripts in package.json (3):
  lint   eslint .
  start  node bin/kinet.js
  test   node --test
```
- Run output (a non-zero exit is a normal result, AC-4.5):
```
script: test
command: node --test
exit code: 1
duration: 4.2 s
--- output ---
[truncated: 812 earlier lines]
…
```
- On timeout, the `exit code:` line becomes `result: timed out after 120 s; process group killed` (AC-4.4).

### 4.5 T5 `kinet_check_deps`

```json
{ "type": "object", "properties": {
    "check": { "type": "string", "enum": ["outdated", "audit", "all"], "default": "all" } } }
```
- Description: "Report outdated npm packages and known vulnerabilities using npm outdated/audit. Read-only; npm audit sends the dependency tree to the npm registry."
- It refuses Windows and a missing `package.json` the same way T4 does.
- An invalid `check` throws `check must be one of: outdated, audit, all`.
- `npm outdated --json` and `npm audit --json` run in parallel, with `timeoutMs 60000`, `maxChars 5_000_000`, `keep 'head'` and env `NO_COLOR=1`. Exit codes 0 and 1 are both normal for both commands.
- Exported pure parsers, which are unit-tested with canned JSON:
  - `export function parseOutdated(stdout, pkg)`:
    - Returns `{ count, packages: [{ name, current, wanted, latest, type }] }`.
    - `type` comes from `pkg`: `dependencies` → `prod`, `devDependencies` → `dev`, `optionalDependencies` → `optional`, `peerDependencies` → `peer`, otherwise `transitive`.
    - An array value (workspaces) is flattened.
    - A missing `current` becomes `"missing"`.
  - `export function parseAudit(stdout)`:
    - Returns `{ counts: { critical, high, moderate, low, info, total }, packages: [{ name, severity, direct, fixAvailable: boolean }] }`.
    - Built from `metadata.vulnerabilities` and `vulnerabilities`.
  - Both throw `Error(code or summary)` when the JSON has an `error` key, empty stdout, or a parse failure.
- Per-section error (AC-5.5): `{ "error": "could not check: <npm error code/summary, or the first stderr line>" }`. For example `ENOLOCK` gives `could not check: no lockfile (run npm install to create one)`, and `ENOTFOUND`/`ECONNREFUSED` gives `could not check: registry unreachable (<code>)`.
- Output (object), with only the requested keys: `{ "outdated": {…} | { "error": "…" }, "audit": {…} | { "error": "…" } }`.

---

## 5. CLI contract (`bin/kinet.js` + `src/cli/mcp.js`)

### 5.1 Commander wiring

- `program.enablePositionalOptions()`.
- `mcp`:
  - `.enablePositionalOptions().allowExcessArguments()`
  - `.option('--port <port>', 'run the HTTP/SSE server in the foreground on 127.0.0.1:<port>', parsePort)`
  - `.description('Run the KINET MCP server. Bare `kinet mcp` is the stdio mode Claude Code launches.')`
  - `.addHelpText('after', …)` lists `start [--port <n>]` (default 7345), `stop`, `status`, `logs [-n <lines>] [-f]`, and the line "Bare `kinet mcp` (no subcommand) runs the stdio server used by Claude Code; your .claude/settings.json does not need to change."
  - The action checks `if (command.args.length) command.error(\`unknown subcommand '${command.args[0]}'. Valid: start, stop, status, logs\`)`. Otherwise it runs `startMcpServer(opts)`, the same as today.
- `start`: `.option('--port <port>', …, parsePort)`.
  - Action: `runMcpStart({ port: opts.port ?? cmd.parent.opts().port ?? DEFAULT_PORT })`.
  - **Review-2 finding 5 decision: forward.** `kinet mcp --port 9000 start` starts on 9000. If both are given, the subcommand's value wins.
- `stop`, `status`: no options. If `cmd.parent.opts().port` is set → `cmd.error("--port only applies to 'kinet mcp start' and foreground 'kinet mcp --port <n>'")`. This prevents a user thinking they are targeting a port.
- `logs`: `-n, --lines <n>` with `parsePositiveInt`, default 50; `-f, --follow`. The same parent `--port` rejection applies.
- Each subcommand lazy-imports `../src/cli/mcp.js`, following the existing pattern.

### 5.2 `kinet mcp start [--port <n>]`

Steps (D2, with review-2 findings 2 and 5):
1. `ensureRunDir`. `release = await acquireLock(cwd)`. On `LockHeldError` → stderr `Error: another 'kinet mcp start' is running for this project (pid <n>).`, exit 1.
2. `checkIdentity`:
   - `running` → stdout block A with the header `KINET MCP server already running`, exit 0 (AC-7.4).
   - `stale` → `clearState`.
   - `unresponsive` → stderr `Error: the MCP server for this project (pid <n>) is not responding. Run: kinet mcp stop`, exit 1. Nothing is started.
3. `token = randomBytes(32).toString('hex')`. Rotate the log: `rename(log, prevLog)`, ignoring `ENOENT`. `fd = await open(log, 'a', 0o600)`.
4. `child = spawn(process.execPath, [BIN_PATH, 'mcp', '--port', String(port)], { cwd, detached: true, windowsHide: true, stdio: ['ignore', fd.fd, fd.fd], env: { ...process.env, KINET_MCP_TOKEN: token } })`, then `await fd.close()`. `BIN_PATH = fileURLToPath(new URL('../../bin/kinet.js', import.meta.url))`.
5. **Signal safety (finding 2):** `onSignal = () => { abortStart(child, release); process.exit(130); }`, registered with `process.once('SIGINT')` and `process.once('SIGTERM')`.
   - `abortStart` calls `process.kill(-child.pid, 'SIGKILL')` (or `child.kill('SIGKILL')` on win32), ignoring `ESRCH`, and then `release()`.
   - Lock removal is safe even if the process exits before `release` resolves, because the next `start` treats that lock as stale (step 1).
6. `waitForHealthy`: poll `probeHealth(port, token)` every 100 ms for up to 4000 ms, racing the child's `exit` event. Success means `status 200 && body.pid === child.pid`.
7. Success:
   - `writeState(cwd, { pid: child.pid, port, token, cwd: body.cwd, startedAt: body.startedAt, logPath, version: body.version })`
   - `child.unref()`
   - stdout block A with the header `KINET MCP server started`
   - exit 0
8. Failure: `abortStart`-style kill if the child is alive. No state is written. Messages go to stderr, exit 1:
   - child exit code 3 → `Error: port <p> is in use. Try: kinet mcp start --port <other>`
   - other child exit → `Error: MCP server exited during startup (code <c>). Last log lines:` + `lastLines(log, 20)`
   - timeout → `Error: MCP server did not become healthy within 4 s. Last log lines:` + 20 lines
9. `finally`: remove both signal listeners, `await release()`.

Block A (stdout):
```
KINET MCP server started
  pid:  12345
  port: 7345
  url:  http://127.0.0.1:7345/sse
  log:  /abs/project/.kinet/run/mcp.log
```

### 5.3 `kinet mcp status`

| Identity result | stdout | exit | side effect |
|-----------------|--------|------|-------------|
| running | block B | 0 | none |
| stopped (no state) | `stopped` | 1 | none |
| stale | `stopped (stale)` | 1 | `clearState` |
| unresponsive (pid alive, `/health` timed out) | block B with `unresponsive` as the first line, no uptime/url, plus a `hint:` line to run `kinet mcp stop` | 2 | none: the state is kept so `stop` can force-kill it |

Block B:
```
running
  pid:    12345
  port:   7345
  url:    http://127.0.0.1:7345/sse
  uptime: 3m 12s
  log:    /abs/project/.kinet/run/mcp.log
```

The first line is always exactly `running`, `unresponsive`, `stopped` or `stopped (stale)`, so scripts can match on it. Identity also requires the state's `cwd` and the `/health` `cwd` to equal `realpath` of the directory the command runs in, so a state file copied with the project (`cp -R`) reads as `stopped (stale)` there (06-test-plan F-5). `status` never spawns, signals or POSTs anything (AC-8.4).

### 5.4 `kinet mcp stop`

1. `checkIdentity`. If the result is `stopped`, print `not running`. If it is `stale`, print `not running (cleared stale state)` and run `clearState`. Exit 0 in both cases (AC-9.2). Nothing is signalled.
2. `running` or `unresponsive`: `POST /shutdown` with the token (1 s timeout; errors are ignored). A hung server ignores it and is force-killed in step 3 (06-test-plan F-1).
3. Poll `isPidAlive(pid)` every 100 ms for up to 5000 ms. If it is still alive, send `process.kill(pid, 'SIGKILL')`.
4. `clearState`. stdout: `stopped (pid 12345)` or `stopped (pid 12345, force-killed after 5 s)`. Exit 0.
5. If `SIGKILL` throws anything other than `ESRCH` → `Error: could not stop pid <n>: <code>`, exit 1, and the state is kept.

### 5.5 `kinet mcp logs [-n <lines>] [-f]`

- No `mcp.log` → stderr `no logs — has \`kinet mcp start\` been run? (looked for <logPath>)`, exit 1 (AC-10.4).
- Otherwise read the file with `fs/promises.readFile` and write `lastLines(text, n)` to stdout. Exit 0.
- `-f`:
  - After printing the tail, set `offset = size`.
  - `fs.watchFile(log, { interval: 250 }, …)`: if `curr.size < offset` (rotated or truncated), reset `offset = 0`. Read the bytes `[offset, curr.size)` through a `FileHandle`, write them, and set `offset = curr.size`.
  - On `SIGINT`, call `unwatchFile` and exit 0.

### 5.6 Exit-code summary

| Command | 0 | 1 | other |
|---------|---|---|-------|
| `kinet mcp` (stdio) | normal end | bad `KINET_MCP_TOKEN` | — |
| `kinet mcp --port N` | shutdown | bad token | 3 = port in use |
| `kinet mcp <unknown>` / bad option | — | commander error (exit 1) | — |
| `start` | started / already running | any failure | 130 = interrupted |
| `status` | running | stopped / stale | 2 = unresponsive |
| `stop` | stopped / not running | could not kill | — |
| `logs` | printed / follow ended | no log file | — |

---

## 6. HTTP routes and the token contract (`http.js`)

The `handler` is `async (req, res) => { try { await route(req, res); } catch (err) { log.error(\`http ${req.method} ${pathname}: ${err.message}\`); if (!res.headersSent) res.writeHead(500).end(); else res.end(); } }` (review-2 finding 3; it also satisfies `node/async-handler-error-handling`). Paths come from `new URL(req.url, 'http://127.0.0.1').pathname`.

Order:
1. **Guard** (D8). `!isAllowedHost(req.headers.host, port)` → `403 Forbidden host`. `!isAllowedOrigin(req.headers.origin, port)` → `403 Forbidden origin`.
2. Route:

| Method + path | Auth | Behaviour | Responses |
|---------------|------|-----------|-----------|
| `GET /sse` | none (guard only) | If `sessions.size >= maxSessions` → 503. Otherwise `transport = new SSEServerTransport('/messages', res)` and `sessions.set(transport.sessionId, transport)`. `transport.onclose` deletes it and logs `INFO session close`. `await createSessionServer().connect(transport)`, then `INFO session open`. | 200 event stream; 503 `Too many sessions` |
| `POST /messages?sessionId=<id>` | none (guard only) | Look up the session. Missing → 404. Otherwise `await transport.handlePostMessage(req, res)`. | 202 (SDK); 404 `Unknown session` |
| `GET /health` | `X-Kinet-Token` | Only if `token` is set (daemon), otherwise 404. Uses `tokenMatches`. | 200 JSON `{ "pid": 12345, "cwd": "/real/path", "startedAt": "2026-10-25T08:00:00.000Z", "version": "1.0.1", "sessions": 0 }`; 401 `{"error":"unauthorized"}` |
| `POST /shutdown` | `X-Kinet-Token` | Daemon only (404 otherwise). On success, respond, then `setImmediate(() => requestShutdown('http'))`. | 202 `{"ok":true}`; 401 |
| anything else | — | — | 404 |

The token:
- 64 lowercase hex characters, generated per `start`.
- Passed to the daemon only through the `KINET_MCP_TOKEN` env var. It is removed from `process.env` at boot and stripped again by `safeExec`.
- Persisted only in `mcp.json` (mode 0600).
- It grants `/health` and `/shutdown` only. MCP routes are not token-gated in v1; they are protected by the 127.0.0.1 bind and the guard (Later item 7). Body `cwd` is `realpath(process.cwd())`, captured at boot.

---

## 7. File formats (`<cwd>/.kinet/run/`)

| File | Format | Mode | Lifecycle |
|------|--------|------|-----------|
| `.gitignore` | `*\n` | default | written by `ensureRunDir` if missing |
| `mcp.json` | `{"pid":12345,"port":7345,"token":"<64 hex>","cwd":"/real/path","startedAt":"<ISO>","logPath":"/abs/.kinet/run/mcp.log","version":"1.0.1"}` | 0600 | written only after a verified health check; removed by `stop`, or by `status`/`stop`/`start` when stale |
| `mcp.json.tmp` | the same | 0600 | renamed over `mcp.json` |
| `mcp.lock` | `{"pid":<start process pid>,"createdAt":"<ISO>"}` | 0600 | created with `open(path,'wx')` and removed in `finally` |
| `mcp.log` | `<ISO> <LEVEL> <message>` lines, plus any raw crash stack traces from stderr | 0600 | renamed to `mcp.log.1` on each `start` |
| `mcp.log.1` | the previous run's log | 0600 | overwritten on the next `start` |

**Stale lock (finding 2):** in `acquireLock`, on `EEXIST`, read the lock. It is stale if any of these hold:
- the JSON is unparseable (then age is judged by mtime)
- `!isPidAlive(lock.pid)`
- `Date.now() - createdAt > 10000`

If it is stale, unlink it and retry `wx` **once**. If it is still held, throw `LockHeldError`.

Log lines written (AC-10.3):
```
2026-10-25T08:00:00.000Z INFO start mode=daemon port=7345 pid=12345 cwd=/real/path version=1.0.1
2026-10-25T08:00:00.010Z INFO listening http://127.0.0.1:7345/sse
2026-10-25T08:00:03.000Z INFO session open id=1a2b3c4d
2026-10-25T08:00:04.200Z INFO tool name=kinet_git_status ms=42 result=ok
2026-10-25T08:00:05.000Z ERROR http POST /messages: <message>
2026-10-25T08:10:00.000Z WARN shutdown reason=http
```
Session ids are logged as the first 8 characters only. Argument values and tool error texts are never logged.

---

## 8. Lint, test glob, packaging

`eslint.config.js`:
```js
import js from '@eslint/js';

const nodeGlobals = Object.fromEntries(
  ['process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'setTimeout', 'clearTimeout', 'setInterval',
   'clearInterval', 'setImmediate', 'AbortController', 'AbortSignal', 'fetch', 'TextDecoder', 'structuredClone', 'performance']
    .map((name) => [name, 'readonly']),
);

export default [
  { ignores: ['node_modules/**', 'templates/**', 'docs/**', '.kinet/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
```
- Globals are inlined rather than adding the `globals` package. The installed copy is only transitive (14.0.0).
- `allowEmptyCatch` keeps `init.js:172` unchanged.
- I probed this config against the current tree. With `allowEmptyCatch`, the remaining 10 errors are all unused imports. Delete them:
  - `src/cli/init.js`: `resolve`, `templatePath`
  - `src/cli/status.js`: `relative`
  - `src/cli/update.js`: `existsSync`, `KINET_CONFIG_FILE`
  - `src/context/distiller.js`: `extname`
  - `src/prp/system.js`: the unused `__dirname` line and the `fileURLToPath`/`dirname` imports that only it uses
  - `src/rules/engine.js`: `relative`, `readdirSync`, `unlinkSync`

  This is dead-code removal only, with no behaviour change.

`package.json`:
- `"test": "node --test"`
- `"lint": "eslint ."`
- devDependencies: add `"@eslint/js": "^9.39.4"`. It is already in the lockfile as a transitive dependency of eslint, so there is no new download. It is a **dev** dependency, so AC-0.6 holds. The PR notes it per `common/dependency-approval`.
- `"files": ["bin", "src", "templates", "!src/**/*.test.js", "!src/test-support"]`. This keeps tests out of the npm tarball. Verify with `npm pack --dry-run` (today: 65 files).

---

## 9. Tests

Shared helpers live in `src/test-support/helpers.js`, which is not matched by the test glob:
- `freePort()`: `net.listen(0)`, then close.
- `tempDir()`: `mkdtemp`, then `realpath`.
- `gitRepo(dir, files)`: `git init -q`, `-c user.name/email`, commit.
- `runCli(args, { cwd, env })`: spawns `process.execPath bin/kinet.js …` and returns `{ code, stdout, stderr }`.
- `waitFor(fn, timeoutMs)`: polls; it never sleeps a fixed time.
- `MARKER = TODO_MARKERS[0]`.

Every lifecycle test runs in its own temp cwd on a `freePort()`, and an `after()` hook runs `stop` so no daemon is leaked.

**P** = spawns real processes (git, npm, node daemon). Everything else is in-process.

| AC | Test file | Asserts | P |
|----|-----------|---------|---|
| 0.1 | `src/mcp/server.test.js` | Over `InMemoryTransport.createLinkedPair()` + SDK `Client`, `tools/list` returns 14 tools. The first 9 names, in order, equal the existing list. Each new tool has `name`, `description` and `inputSchema.type === 'object'`. | |
| 0.2 | each tool test | Runs in a temp dir with no `.kinet/` and gets a non-error result | P |
| 0.3 | `git-status.test.js`, `git-diff.test.js`, `run-script.test.js`, `check-deps.test.js` | A non-repo dir returns text starting `Not a git repository`. A dir with no `package.json` returns `No package.json`. No throw. | P |
| 0.4 | `src/utils/exec.test.js` | `capText` head and tail output, and the exact `[truncated: N more lines]` / `N earlier lines` text. `safeExec` with `maxChars:100` on 1000 printed lines → `truncated:true` and the marker present. | P (node) |
| 0.5 | `exec.test.js`, `git-diff.test.js` | `safeExec('node',['-e','console.log(process.argv[1])','$(touch pwned); echo x'])` echoes the literal and creates no `pwned` file. T2 `ref:'HEAD; touch pwned'` returns `Unknown ref` and creates no file. | P |
| 0.6 | `src/package.test.js` | `dependencies` keys equal the current 9 | |
| 0.7, 11.3 | `src/readme.test.js` | README contains all 14 tool names in the MCP table, plus `kinet mcp start`, `stop`, `status`, `logs`, `127.0.0.1` | |
| 0.8a | `git-diff.test.js`, `src/utils/args.test.js` | `ref:'--output=/tmp/x'` (with a unique temp path) is refused and no file is written. `path:'-x'` is refused. | P |
| 0.8b | `git-diff.test.js`, `find-todos.test.js` | `buildDiffArgs({scope:'working',path:'src'},{stat:false})` has `'--'` at an index lower than `'src'`. Same for `buildGrepArgs('src')`. | |
| 0.8c | `args.test.js` | `resolveInsideProject(dir,'../..')` and `(dir,'/etc')` reject. A symlink inside dir pointing to `/etc` rejects. `'src'` → `'src'`. | |
| 0.9 | `src/mcp/no-sync.test.js` | The source of the 5 tool files, `exec.js`, `args.js`, `http.js`, `log.js` and `runstate.js` contains no `execSync`, `spawnSync`, `execFileSync`, `readFileSync` or `writeFileSync`. | |
| 1.1-1.3 | `git-status.test.js` | Staged, unstaged and untracked files land in the right lists. A bare repo used as upstream gives `ahead 1, behind 0`. `commits: 2` returns 2 lines and `commits: 999` is clamped to 50. A detached checkout prints `detached HEAD at`. A repo with no commits prints `no commits yet`. | P |
| 1.4 | `git-status.test.js` | `git status --porcelain` and `rev-parse HEAD` are identical before and after. No `.git/index.lock` appears. | P |
| 2.1-2.5 | `git-diff.test.js` | `working`, `staged` and `ref: main` each show the expected file in the stat and `+line` in the patch. `path` limits the output to one file. An unknown ref names the ref. A clean tree starts with `No changes`. `scope:'ref'` without `ref` throws. | P |
| 3.1, 3.3, 3.4 | `find-todos.test.js` | A fixture repo with markers, `myTODOs`, nested and top-level `node_modules` (not gitignored), a gitignored dir and a binary file. Only the real markers come back, with file, line, marker and text. `missingTicketOnly` filters the results while the counts stay the same. Non-git fallback dir gives the same results. | P |
| 3.2 | `src/rules/patterns.test.js` | `missingTicketPattern(MARKER).source === MARKER + String.raw\`(?!\s*\[#?\w+[-_]\d+\])\`` and flags `'i'`. For each line in a table (`${MARKER} [PROJ-123]`, `${MARKER} fix this`, `${MARKER} [#ABC_12]`, `x ${MARKER}[P-1] and later ${MARKER.toLowerCase()}`), `commonValidators` `no-todo-without-ticket` flags the line ⇔ T3's `hasTicket === false`. Also checks the `kinet validate` output on a fixture is unchanged (same lines flagged as before the refactor). | |
| 4.1-4.6 | `run-script.test.js` | Fixture scripts: `ok` (`node -e "console.log('hi')"`), `fail` (exit 3), `slow` (setTimeout 60 s), `loud` (prints 50k lines). No script → a list, and nothing runs (a marker file is not created). `"x; rm -rf ~"` and `__proto__` are refused with the valid names. `fail` → `exit code: 3` with `isError` not set. `slow` with `timeoutSeconds:1` → `timed out`, and the grandchild pid is gone. `loud` → keeps the tail and shows the `earlier lines` marker. The description contains `executes project code`. A script printing `process.env.KINET_MCP_TOKEN` prints `undefined` when the test sets that env var. | P (npm) |
| 5.1, 5.2 | `check-deps.test.js` | `parseOutdated` and `parseAudit` on canned npm JSON give the documented shapes and prod/dev types. | |
| 5.3-5.5 | `check-deps.test.js` | With `npm_config_registry=http://127.0.0.1:9`, `npm_config_fetch_retries=0` and `npm_config_fetch_timeout=2000` set in `process.env` (test files run in separate processes): `check:'all'` returns per-section `error` text and no throw. `package.json` and `package-lock.json` are byte-identical before and after. `check:'audit'` returns only the `audit` key. | P (npm) |
| 6.1, 6.3 | `src/cli/mcp-routing.test.js` | Via `StdioClientTransport({ command: process.execPath, args:[bin,'mcp'], stderr:'pipe' })` in a temp cwd: `initialize` + `listTools` → 14. The client `onerror` never fires (stdout is protocol only). stderr contains `INFO start mode=stdio`. | P |
| 6.2 | `mcp-routing.test.js` | `mcp --port <free>` in the foreground: two `SSEClientTransport` clients connected at the same time both `listTools`. `GET /health` → 404. `Host: evil.example` → 403. `Origin: http://evil.example` → 403. | P |
| 6.4 | `mcp-routing.test.js` | `src/cli/init.js` source still contains `args: ['mcp']` | |
| 6.5, 6.6 | `mcp-routing.test.js` | `mcp --help` stdout contains `start`, `stop`, `status`, `logs`, `stdio`. `mcp foo` → non-zero exit within 3 s, and stderr contains `unknown subcommand 'foo'` and `start, stop, status, logs`. `mcp --port 1 status` → non-zero exit with `--port only applies`. `parsePort('80abc')` throws. | P |
| 7.1-7.4, 8.1, 9.1, 10.1, 10.3, 10.5 | `src/cli/mcp-lifecycle.test.js` | `start` returns in under 5 s, exit 0, and stdout has `url:  http://127.0.0.1:<p>/sse`. `mcp.json` exists, and `git check-ignore .kinet/run/mcp.json` succeeds in a temp git repo. A second `start` → `already running` with the same pid. `kinet mcp --port <p2> start` uses p2 (forwarding). `status` → `running`, exit 0. Call `kinet_git_diff` over SSE with `path:'SECRET_ARG_123'`, then `logs -n 5` → exit 0. `stop` → `stopped (pid N)`. `status` → `stopped`, exit 1. The log file still exists and contains `start`, `tool name=kinet_git_diff`, `shutdown`, and **not** `SECRET_ARG_123`. A second `start` → `mcp.log.1` holds the previous run. | P |
| 7.5 | `mcp-lifecycle.test.js` | Occupy a port with `net.createServer().listen(p,'127.0.0.1')`. `start --port p` → exit 1, stderr has `port p is in use`, and neither `mcp.json` nor `mcp.lock` exists. | P |
| 7.6 | `src/mcp/http.test.js`, `mcp-lifecycle.test.js` | In-process: after `startMcpServer`-style listen, `server.address().address === '127.0.0.1'`. Lifecycle: a connection to `127.0.0.1:p` succeeds. Connecting to the first non-internal IPv4 from `os.networkInterfaces()` gets `ECONNREFUSED`; this part is skipped if there is none. | P |
| 8.2-8.4, 9.2, 9.3 | `mcp-lifecycle.test.js` | Write `mcp.json` with the pid of a live unrelated `node -e "setTimeout(()=>{},30000)"` process plus a random port and token. `status` → `stopped (stale)`, exit 1, and the file is gone. Write it again, then `stop` → `not running (cleared stale state)`, exit 0, and the unrelated process **is still alive**. `status` with no state creates no files apart from the run dir. | P |
| 10.2 | `mcp-lifecycle.test.js` | Spawn `logs -f`, append a line to `mcp.log`, and wait for it on stdout. Send SIGINT → exit 0. | P |
| 10.4 | `mcp-lifecycle.test.js` | In a fresh dir, `logs` → exit 1 with `no logs`. | P |
| finding 2 | `src/mcp/runstate.test.js`, `src/cli/mcp.test.js` | A lock holding a dead pid (from a node child that has already exited) → `acquireLock` succeeds. A lock with a live pid that is less than 10 s old → `LockHeldError`. A lock older than 10 s → succeeds. `abortStart(child, release)` kills a detached dummy child and the lock file is gone. | P |
| finding 3 | `http.test.js` | `createRequestHandler` with a `createSessionServer` that throws → the response is 500, the log has `ERROR http GET /sse`, and the handler promise does not reject. Token: `tokenMatches` returns false for a wrong value, a missing value and a different length. `/health` with no token mode → 404. | |
| finding 4 | `exec.test.js` | `safeExec` spawns `sh -c 'sleep 30 & wait'` (test only), then `killActiveProcessGroups()` → the grandchild is gone, checked with `isPidAlive` on the pid echoed by the script. A child env does not contain `KINET_MCP_TOKEN`. | P |
| 11.1 | — (Tester) | `npm test` exits 0 and the summary shows `tests N` with N > 0. Node's default reporter prints `ℹ tests N` on a TTY and `# tests N` under TAP. | |
| 11.2 | — (Tester) | `npm run lint` exits 0. `kinet validate --json` gives `violations: []`, and warnings ≤ baseline + 1 (`src/rules/patterns.js` marker list). | |
| manual | TSR | Ctrl-C during `start`: hard to time automatically. The Tester runs `kinet mcp start` and presses Ctrl-C at once, then checks that `status` shows `stopped`, there is no `mcp.lock`, and no orphan `node … mcp --port` remains (`pgrep -f "kinet.js mcp --port"`). | |

---

## 10. Build sequence (for Manager/Developer)

1. `patterns.js` + the `common.js` change + `patterns.test.js`, with a before/after `kinet validate` check.
2. `exec.js` and `args.js`, with their tests.
3. The five tools + `local.js`, one at a time with tests (T1 → T2 → T3 → T4 → T5).
4. `log.js`, `http.js`, and the `server.js` split. Run `server.test.js`, `http.test.js` and the routing tests for bare and `--port`.
5. `runstate.js`, `src/cli/mcp.js`, and the `bin/kinet.js` wiring. Run the lifecycle tests.
6. `eslint.config.js`, the unused-import deletions, and the `package.json` scripts/files. README.
7. Full check: `npm run lint`, `npm test`, `kinet validate`, `npm pack --dry-run`.

Steps 2 and 4 do not depend on each other. Everything else runs in order.

---

## 11. Open items

- [TBC-2: D8 Host/Origin guard is pending Security sign-off; designed in as specified. – Security]
- [TBC-3: confirm "top 5 MCP tools" means tools in KINET's own server (01 §7). – Saurabh at close-out]
- Accepted limitation, documented in the README: if the daemon is SIGKILLed (`stop` fallback, or `kill -9`), a `kinet_run_script` process group still running is orphaned. A graceful `/shutdown`, SIGTERM or SIGINT kills it.
