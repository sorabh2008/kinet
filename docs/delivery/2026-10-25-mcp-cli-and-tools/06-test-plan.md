# 06 — Test plan: MCP lifecycle CLI + 5 solo-dev MCP tools

Stage: Tester (6a) | Branch: `feature/mcp-cli-and-tools` (revised against head `d5a94e3`: the build commits, the security-stage fixes and the fixes for F-1/F-2/F-4/F-5/F-6. Refresh the head here and in TC-S2 at freeze) | Date: 2026-10-25
Inputs: `01-requirement.md` (ACs), `03-design.md` (build contract, including the §5.1/§5.3/§5.4/§5.6 amendments for F-1/F-5/F-6), `review-5.md`, `review-6a.md` (all 11 findings addressed in this revision), the branch source (`bin/kinet.js`, `src/cli/mcp.js`, `src/mcp/**`, `src/utils/{exec,args}.js`, `README.md`).

`/test-and-ship` freezes this list and runs it. Every case has an ID, the ACs it traces to, preconditions, copy-paste steps and a measurable expected result. Section 12 holds the AC → TC traceability table. Section 13 lists what the dry run already found.

---

## 0. Environment and limits

1. **macOS only** (Darwin 27, Apple Silicon). Not covered: Linux, where binding `127.0.0.1:P` while `*:P` is held fails with `EADDRINUSE` (see TC-94), and Windows. On Windows `kinet_run_script` and `kinet_check_deps` refuse to run by design, and the process-group kill is POSIX-only.
2. **Node 24.15.0 only.** `engines` says `>=20`, and design §0.3 says the bare `node --test` was checked on Node 20/22/26. This run cannot re-check that. Node 20/22 behaviour is **NOT RUN (environment)**. Do not mark it passed.
3. git 2.54, npm bundled with Node 24, `curl`, `lsof`, `pgrep` and `openssl` are all required. `timeout(1)` is **not** installed on macOS, so no step uses it.
4. Network is needed only by TC-48 and TC-121 (npm registry, DuckDuckGo/GitHub). If you are offline, mark those **BLOCKED (network)**, not failed.
5. No production data. All fixtures live under `/tmp/kinet-tsr`. The kinet repo itself is used read-only, and TC-47/48 check that with checksums.
6. **Shell: run every step in `bash`**, not zsh. zsh errors on unmatched globs. Each step starts with `source /tmp/kinet-tsr/env.sh` because shell state does not carry over between tool calls.
7. Ports used: 7345 (default), and 47311-47319. TC-S2 checks that they are free.

## 1. Automated vs manual

| Kind | Cases | How |
|------|-------|-----|
| **A**: automated by the repo suite (`npm test`, N ≥ 117 tests) | Run as part of TC-1. The traceability table names the test that covers each AC. | `npm test` |
| **S**: scripted here, run by `/test-and-ship` | Most of TC-2 … TC-124 | Copy-paste bash below |
| **M**: manual, needs a human at a real terminal or client | TC-M1 … TC-M5 | Saurabh, or the tester at a real Terminal.app window |

The scripted cases repeat several things the suite already asserts. That is on purpose: the suite drives the code in-process or through helpers, and these cases drive the real CLI the way a user would.

---

## 2. Setup (run once, in this order)

### TC-S1 Write the helpers (`env.sh`, `fmt.js`)

```bash
mkdir -p /tmp/kinet-tsr
cat > /tmp/kinet-tsr/env.sh <<'EOF'
export TSR=/tmp/kinet-tsr
export R=/Users/sjain/dev/personal/kinet
export K="$R/bin/kinet.js"
export FX="$TSR/fx" FXU="$TSR/fxu" PLAIN="$TSR/plain" BIG="$TSR/big" EMPTY="$TSR/empty" KFX="$TSR/kfx" OTHER="$TSR/other"
export P_DEF=7345 P1=47311 P2=47312 P_BUSY=47313 P_WILD=47314 P_FG=47315 P_FRZ=47316 P_CC=47317 P_OTHER=47318 P_LOCK=47319
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"tsr","version":"0"}}}'
NOTE='{"jsonrpc":"2.0","method":"notifications/initialized"}'
call() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2" "$3"; }
list() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/list"}' "$1"; }
# Bare stdio server in $PWD: initialize, then each request; stdin stays open MCP_WAIT s (default 2).
mcp_raw() { { printf '%s\n' "$INIT" "$NOTE" "$@"; sleep "${MCP_WAIT:-2}"; } | node "$K" mcp 2>"$TSR/last-stderr.txt"; }
# One line per response, sorted by id: id=N isError=B "<text, first MCP_MAX chars>" (or tools=N for tools/list).
mcp_rpc() { mcp_raw "$@" | node "$TSR/fmt.js"; }
port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
# SSE client: sse_open PORT; sse_post PORT JSON; sse_msgs; sse_close
sse_open() { : > "$TSR/sse.out"; curl -sN -H 'Accept: text/event-stream' "http://127.0.0.1:$1/sse" > "$TSR/sse.out" & SSE_PID=$!; EP=; for i in $(seq 1 30); do EP=$(grep -m1 '^data: ' "$TSR/sse.out" | sed 's/^data: //' | tr -d '\r'); [ -n "$EP" ] && break; sleep 0.1; done; echo "endpoint=$EP"; }
sse_post() { curl -s -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -d "$2" "http://127.0.0.1:$1$EP"; }
sse_msgs() { grep '^data: {' "$TSR/sse.out" | sed 's/^data: //' | node "$TSR/fmt.js"; }
sse_close() { kill "$SSE_PID" 2>/dev/null; wait "$SSE_PID" 2>/dev/null; }
EOF
cat > /tmp/kinet-tsr/fmt.js <<'EOF'
let d = '';
process.stdin.on('data', (c) => (d += c)).on('end', () => {
  const max = Number(process.env.MCP_MAX || 400);
  // JSON.parse throws on any non-JSON stdout line: that is the AC-6.3 check.
  const msgs = d.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.id !== 1);
  if (process.env.MCP_ORDER) console.log('arrival order: ' + msgs.map((m) => m.id).join(','));
  for (const m of msgs.sort((a, b) => a.id - b.id)) {
    if (m.result?.tools) { console.log(`id=${m.id} tools=${m.result.tools.length} ${m.result.tools.map((t) => t.name).join(',')}`); continue; }
    const text = m.result?.content?.[0]?.text ?? JSON.stringify(m.error);
    console.log(`id=${m.id} isError=${Boolean(m.result?.isError)} ${JSON.stringify(text).slice(0, max)}`);
  }
});
EOF
echo ok
```
Expected: prints `ok`.

### TC-S2 Preconditions

```bash
source /tmp/kinet-tsr/env.sh
cd "$R" && git branch --show-current && git rev-parse --short HEAD && node -v
for p in $P_DEF $P1 $P2 $P_BUSY $P_WILD $P_FG $P_FRZ $P_CC $P_OTHER $P_LOCK; do port_free $p || echo "BUSY $p"; done
pgrep -fl "kinet.js mcp" ; echo "no-stray-servers=$?"
```
Expected: `feature/mcp-cli-and-tools`, the frozen head (`d5a94e3` when this plan was revised), `v24.x`, no `BUSY` lines, `no-stray-servers=1`.

### TC-S3 Fixtures

```bash
source /tmp/kinet-tsr/env.sh
rm -rf "$FX" "$FXU" "$PLAIN" "$BIG" "$EMPTY" "$KFX" "$OTHER" "$TSR"/pwn*
# FX: git repo on branch `feature` (1 commit ahead of main) with staged, unstaged, untracked, ignored, binary and node_modules files.
mkdir -p "$FX/src" && cd "$FX" && git init -q -b main && git config user.name tsr && git config user.email tsr@example.invalid
node -e '
require("fs").writeFileSync("package.json", JSON.stringify({ name: "fx", version: "1.0.0", scripts: {
  ok:   "node -e \"console.log(42)\"",
  fail: "node -e \"console.error(\x27boom\x27);process.exit(3)\"",
  slow: "node -e \"setTimeout(()=>{},60000)\"",
  loud: "node -e \"for(let i=0;i<50000;i++)console.log(\x27line \x27+i)\"",
  env:  "node -e \"console.log(\x27token=\x27+process.env.KINET_MCP_TOKEN)\""
} }, null, 2) + "\n");'
printf '%s\n' '// TODO fix this' '// TODO [PROJ-123] tracked' '// FIXME later' '// HACK [ABC-9] ok' 'const myTODOs = 1;' '// XXX' > src/a.js
printf 'export const c = 1;\n' > src/c.js
printf 'build/\n' > .gitignore
git add -A && git commit -qm 'chore: init'
git checkout -q -b feature && printf 'export const b = 1;\n' > src/b.js && git add src/b.js && git commit -qm 'feat: b'
printf 'export const c = 2;\n' > src/c.js                                   # unstaged
printf 'export const s = 1;\n' > src/staged.js && git add src/staged.js     # staged
printf 'just notes\n' > notes.txt                                            # untracked
mkdir -p build node_modules/x src/node_modules/y
printf '// TODO ignored build file\n' > build/gen.js                         # gitignored
printf '// TODO dependency\n' > node_modules/x/i.js                          # not ignored, top level
printf '// TODO nested dependency\n' > src/node_modules/y/j.js               # not ignored, nested
printf 'TODO\0binary\n' > bin.dat                                            # binary
# FXU: clone of FX (upstream origin/feature), clean tree
git clone -q "$FX" "$FXU" && git -C "$FXU" config user.name tsr && git -C "$FXU" config user.email tsr@example.invalid
# PLAIN: not a git repo, no package.json, same marker file plus node_modules and binary
mkdir -p "$PLAIN/src" "$PLAIN/node_modules/x" && cp "$FX/src/a.js" "$PLAIN/src/" && cp "$FX/node_modules/x/i.js" "$PLAIN/node_modules/x/" && cp "$FX/bin.dat" "$PLAIN/"
# BIG: one file with a 5000-line unstaged change
mkdir -p "$BIG" && cd "$BIG" && git init -q -b main && printf 'x\n' > big.txt && git add -A && git -c user.name=t -c user.email=t@e commit -qm init && seq 1 5000 | sed 's/^/line number /' > big.txt
# EMPTY: git repo with no commits
mkdir -p "$EMPTY" && git -C "$EMPTY" init -q -b main
# KFX: KINET-initialised copy of this repo's .kinet + config + src (for the 9 core tools)
mkdir -p "$KFX" && cp -R "$R/.kinet" "$R/kinet.config.json" "$R/src" "$KFX/" && rm -rf "$KFX/.kinet/run"
# OTHER: a second project for multi-project cases
mkdir -p "$OTHER" && printf '{"name":"other","version":"1.0.0"}\n' > "$OTHER/package.json"
cd "$FX" && git status --porcelain && test ! -e "$FX/.kinet" && echo FIXTURES-OK
```
Expected: the porcelain lines include ` M src/c.js`, `A  src/staged.js`, `?? notes.txt`, `?? bin.dat`, `?? node_modules/`, `?? src/node_modules/`, and do **not** include `build/`. The last line is `FIXTURES-OK`.

**Seed-data rule:** TC-23/24 change `FXU`, and TC-57 adds and removes a symlink in `FX`. Each does this only inside its own case and says so. Every other case expects FX exactly as built here. If a case fails halfway, re-run TC-S3 before the next case.

---

## 3. Automated suite and static gates

### TC-1 Full test suite (A). AC-11.1 plus every AC marked "A" in §12
Steps: `cd /Users/sjain/dev/personal/kinet && npm test; echo "exit=$?"`
Expected: `exit=0`, `ℹ tests N` with N ≥ 117 (117 at `d5a94e3`), `ℹ fail 0`, `ℹ cancelled 0`. Takes about 4 s. Afterwards `pgrep -fl "kinet.js mcp"` prints nothing, so the suite leaks no daemons.

### TC-2 Lint. AC-11.2
Steps: `cd /Users/sjain/dev/personal/kinet && npm run lint; echo "exit=$?"`
Expected: `exit=0` with no error lines.

### TC-3 `kinet validate` adds no violations. AC-11.2 (+ design §0.5 warning budget)
```bash
cd /Users/sjain/dev/personal/kinet && node bin/kinet.js validate --json > /tmp/kinet-tsr/validate.json; echo "exit=$?"
node -e 'const r=require("/tmp/kinet-tsr/validate.json");const c={};for(const w of r.warnings)c[w.rule]=(c[w.rule]||0)+1;console.log("violations="+r.violations.length,"warnings="+r.warnings.length,JSON.stringify(c))'
```
Expected: `exit=0`, `violations=0 warnings=33 {"no-todo-without-ticket":8,"no-console-log-prod":25}`.
- `violations=0` is the AC. F-4 is fixed at `d5a94e3`.
- `warnings=33` is the accepted figure (F-3 is an accepted deviation; see §13). It is the develop baseline of 29, plus 1 for `src/rules/patterns.js`, plus 3 false positives where the validator matches the name `find-todos`/`kinet_find_todos`. More than 33 is a FAIL. Fewer is fine.
- Dry run at `d5a94e3`: exactly this.

### TC-4 Packaging excludes tests (design §8)
Steps: `cd /Users/sjain/dev/personal/kinet && npm pack --dry-run 2>&1 | grep -cE '\.test\.js|test-support'; npm pack --dry-run 2>&1 | grep 'total files'`
Expected: count `0`. `total files` is printed (80 at freeze).

### TC-5 No new production dependency. AC-0.6
```bash
cd /Users/sjain/dev/personal/kinet && node -e '
const cur=require("./package.json").dependencies;
const old=JSON.parse(require("child_process").execFileSync("git",["show","develop:package.json"])).dependencies;
const a=Object.keys(cur).sort().join(","), b=Object.keys(old).sort().join(",");
console.log(a===b?"NO-NEW-PROD-DEPS":"DEP-SET-CHANGED: "+a);
for (const k of Object.keys(cur)) if (cur[k]!==old[k]) console.log("range changed:", k, old[k], "->", cur[k]);'
```
Expected: `NO-NEW-PROD-DEPS`. The only range change allowed is `range changed: @modelcontextprotocol/sdk ^1.12.0 -> ^1.32.0` (commit `ef2391b`, a security-stage fix that raises the floor of an existing dependency). That is not a new dependency. The only devDependency added is `@eslint/js`.

### TC-6 No synchronous child-process calls in new tool code. AC-0.9 (static)
Steps: `cd /Users/sjain/dev/personal/kinet && grep -nE 'execSync|spawnSync|execFileSync|readFileSync|writeFileSync' src/mcp/tools/{git-status,git-diff,find-todos,run-script,check-deps,git-common,npm-common,local}.js src/utils/{exec,args}.js src/mcp/{http,log,runstate}.js src/cli/mcp.js; echo "matches-exit=$?"`
Expected: no output, `matches-exit=1`. TC-44 is the behavioural half.

### TC-7 Test-script form. AC-11.1
Steps: `cd /Users/sjain/dev/personal/kinet && node -p 'require("./package.json").scripts.test'`
Expected: `node --test`. This is an accepted deviation from the AC's "quoted glob": design §0.3 notes that a quoted glob fails on Node 20. The AC's real protection is the non-zero count, which TC-1 checks.

---

## 4. Smoke

### TC-10 Top-level help (S)
Steps: `node /Users/sjain/dev/personal/kinet/bin/kinet.js --help; echo "exit=$?"`
Expected: `exit=0`. It lists `init`, `update`, `validate`, `refresh`, `mcp`, `status`.

### TC-11 `kinet mcp --help`. AC-6.5
```bash
source /tmp/kinet-tsr/env.sh; node "$K" mcp --help > "$TSR/help.txt"; echo "exit=$?"
for w in start stop status logs stdio 'settings.json does not need to change' 'default port 7345' '127.0.0.1'; do grep -q -- "$w" "$TSR/help.txt" && echo "has: $w" || echo "MISSING: $w"; done
```
Expected: `exit=0`, 8 `has:` lines, no `MISSING`.

### TC-12 Bare stdio: initialize + tools/list = 14. AC-6.1, AC-0.1
```bash
source /tmp/kinet-tsr/env.sh; cd "$FX"; mcp_rpc "$(list 2)"; echo "pipe-exit=$?"; cat "$TSR/last-stderr.txt"
```
Expected: `id=2 tools=14 kinet_web_search,kinet_github_search,kinet_get_context,kinet_get_rules,kinet_get_prp,kinet_memory_recall,kinet_memory_save,kinet_get_skill,kinet_validate,kinet_git_status,kinet_git_diff,kinet_find_todos,kinet_run_script,kinet_check_deps`, in exactly this order (the 9 core tools first). `pipe-exit=0`. stderr has one line `… INFO start mode=stdio port=- pid=<n> cwd=/private/tmp/kinet-tsr/fx version=1.0.1`.

### TC-13 stdout carries protocol only, even while a script prints. AC-6.3
```bash
source /tmp/kinet-tsr/env.sh; cd "$FX"
mcp_raw "$(call 2 kinet_run_script '{"script":"ok"}')" "$(call 3 kinet_git_status '{}')" > "$TSR/stdout.txt"
node -e 'const ls=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n");const bad=ls.filter(l=>{try{return JSON.parse(l).jsonrpc!=="2.0"}catch{return true}});console.log("lines="+ls.length,"non-protocol="+bad.length)' "$TSR/stdout.txt"
grep -c '' "$TSR/last-stderr.txt"
```
Expected: `lines=3 non-protocol=0`. The `42` printed by the script shows up only inside a JSON string. stderr has ≥ 1 line.

### TC-14 New tool definitions. AC-0.1, AC-4.6
```bash
source /tmp/kinet-tsr/env.sh; cd "$FX"; mcp_raw "$(list 2)" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.tools.slice(9);for(const x of t)console.log(x.name, !!x.description, x.inputSchema?.type, Object.keys(x.inputSchema?.properties||{}).join("|"));console.log("T4 warns:", /executes project code/.test(t.find(x=>x.name==="kinet_run_script").description))})'
```
Expected: 5 lines with `true object`. Properties: git_status `commits`. git_diff `scope|ref|path`. find_todos `path|missingTicketOnly`. run_script `script|timeoutSeconds`. check_deps `check`. Last line `T4 warns: true`.

---

## 5. The 5 tools (stdio, in fixtures)

All cases: `source /tmp/kinet-tsr/env.sh` first. "isError=false" means a normal result.

### TC-20 git_status in FX. AC-1.1, AC-1.2, AC-0.2
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_git_status '{}')"`
Expected: `isError=false`. The text contains `branch: feature (no upstream)`. `staged (1):` with `src/staged.js`. `unstaged (1):` with `src/c.js`. `untracked (` listing `notes.txt`, `bin.dat`, `node_modules/`, `src/node_modules/` and **not** `build/`. `conflicted: none`. `recent commits (2):` with two lines in the form `<7-char hash>  <ISO date>  tsr  <subject>` (`feat: b`, then `chore: init`). It ends with `(paths are relative to the repository root)`. FX has no `.kinet/` (AC-0.2).

### TC-21 git_status commit count. AC-1.2
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_git_status '{"commits":1}')" "$(call 3 kinet_git_status '{"commits":"abc"}')"`
Expected: id=2 shows `recent commits (1):` with `feat: b` only. id=3 falls back to the default and shows `recent commits (2):`, `isError=false`. The clamp to 50 is covered by TC-1 (`clamps the commit count to 1..50`).

### TC-22 git tools are read-only. AC-1.4
```bash
cd "$FX"; before="$(git status --porcelain=v2; git rev-parse HEAD; git stash list)"
mcp_rpc "$(call 2 kinet_git_status '{}')" "$(call 3 kinet_git_diff '{}')" "$(call 4 kinet_git_diff '{"scope":"staged"}')" "$(call 5 kinet_find_todos '{}')" >/dev/null
after="$(git status --porcelain=v2; git rev-parse HEAD; git stash list)"; [ "$before" = "$after" ] && echo UNCHANGED || echo CHANGED; test ! -e .git/index.lock && echo NO-LOCK
```
Expected: `UNCHANGED`, `NO-LOCK`.

### TC-23 Upstream ahead/behind. AC-1.1. *Changes FXU: adds one local commit.*
```bash
cd "$FXU"; printf 'ahead\n' > ahead.txt && git add ahead.txt && git commit -qm 'feat: ahead'
mcp_rpc "$(call 2 kinet_git_status '{}')"
```
Expected: the text starts with `branch: feature (upstream origin/feature, ahead 1, behind 0)`.

### TC-24 Detached HEAD. AC-1.3. *Changes FXU: detaches HEAD.*
Steps: `cd "$FXU"; git checkout -q --detach HEAD; mcp_rpc "$(call 2 kinet_git_status '{}')"`
Expected: `isError=false`. The text starts with `branch: (detached HEAD at <short hash>)`.

### TC-25 Repo with no commits. AC-1.3, AC-0.3
Steps: `cd "$EMPTY"; mcp_rpc "$(call 2 kinet_git_status '{}')" "$(call 3 kinet_git_diff '{}')"`
Expected: id=2 `isError=false`, containing `no commits yet` (both the branch line and the commits section). id=3 is a plain message, not a stack trace, `isError=false`.

### TC-26 git_diff working (default). AC-2.1, AC-2.2
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_git_diff '{}')"`
Expected: `isError=false`. The text starts with `diff: working tree vs index (unstaged)`. Then the stat: ` src/c.js | 2 +-` and `1 file changed, 1 insertion(+), 1 deletion(-)`. Then a patch with `-export const c = 1;` and `+export const c = 2;`. No `src/staged.js` and no `notes.txt`.

### TC-27 git_diff staged. AC-2.1
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_git_diff '{"scope":"staged"}')"`
Expected: starts with `diff: index vs HEAD (staged)`. Stat line for `src/staged.js`, `+export const s = 1;`. No `src/c.js`.

### TC-28 git_diff ref. AC-2.1
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_git_diff '{"scope":"ref","ref":"main"}')"`
Expected: starts with `diff: main...HEAD`. Stat for `src/b.js`, `+export const b = 1;`. Working and staged changes are not included.

### TC-29 git_diff path filter. AC-2.3, AC-0.8b (behaviour)
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_git_diff '{"path":"src/c.js"}')" "$(call 3 kinet_git_diff '{"path":"src/a.js"}')" "$(call 4 kinet_git_diff '{"scope":"ref","ref":"main","path":"src"}')"`
Expected: id=2 shows only `src/c.js`. id=3 starts with `No changes`. id=4 shows `src/b.js`. The arg ordering (`--` before the path) is unit-tested in TC-1 (`paths come after the -- separator`).

### TC-30 Unknown ref. AC-2.4
Steps: `cd "$FX"; mcp_rpc "$(call 2 kinet_git_diff '{"scope":"ref","ref":"nope-ref"}')"`
Expected: `id=2 isError=false "Unknown ref \"nope-ref\": not a commit in this repository."` No `at ` stack lines.

### TC-31 No changes. AC-2.5
Steps: `cd "$FXU"; mcp_rpc "$(call 2 kinet_git_diff '{}')" "$(call 3 kinet_git_diff '{"scope":"staged"}')"` (FXU is clean after TC-23/24)
Expected: id=2 text starts with `No changes (working tree vs index (unstaged)).` and mentions `Untracked files are not shown; see kinet_git_status.` id=3 starts with `No changes (index vs HEAD (staged)).` Neither text is empty.

### TC-32 git_diff argument validation. AC-2.1
Steps: `cd "$FX"; mcp_rpc "$(call 2 kinet_git_diff '{"scope":"ref"}')" "$(call 3 kinet_git_diff '{"scope":"bogus"}')"`
Expected: id=2 `isError=true "Error: ref is required when scope is \"ref\""`. id=3 `isError=true "Error: scope must be one of: working, staged, ref"`.

### TC-33 Output cap and truncation marker. AC-0.4
```bash
cd "$BIG"; mcp_raw "$(call 2 kinet_git_diff '{}')" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.content[0].text;console.log("len="+t.length, "marker="+/\[truncated: \d+ more lines\]/.test(t))})'
```
Expected: `len=` ≤ 20000 and `marker=true`.

### TC-34 find_todos in a git repo. AC-3.1, AC-3.2, AC-3.3
```bash
cd "$FX"; mcp_raw "$(call 2 kinet_find_todos '{}')" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.content[0].text);console.log("total="+o.total,"missing="+o.missingTicket);for(const r of o.results)console.log(r.file,r.line,r.marker,r.hasTicket,JSON.stringify(r.text))})'
```
Expected, exactly:
```
total=5 missing=3
src/a.js 1 TODO false "// TODO fix this"
src/a.js 2 TODO true "// TODO [PROJ-123] tracked"
src/a.js 3 FIXME false "// FIXME later"
src/a.js 4 HACK true "// HACK [ABC-9] ok"
src/a.js 6 XXX false "// XXX"
```
None of `myTODOs` (line 5), `node_modules/…`, `src/node_modules/…`, `build/gen.js` (gitignored) or `bin.dat` (binary) appear.

### TC-35 find_todos filters. AC-3.4
```bash
cd "$FX"; for a in '{"missingTicketOnly":true}' '{"path":"src"}' '{"path":"src/a.js","missingTicketOnly":true}'; do
  mcp_raw "$(call 2 kinet_find_todos "$a")" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.content[0].text);console.log("total="+o.total,"missing="+o.missingTicket,"n="+o.results.length,"lines="+o.results.map(r=>r.line).join(","))})'; done
```
Expected, exactly:
```
total=5 missing=3 n=3 lines=1,3,6
total=5 missing=3 n=5 lines=1,2,3,4,6
total=5 missing=3 n=3 lines=1,3,6
```

### TC-36 find_todos outside git (fallback scan). AC-0.2, AC-3.3
```bash
cd "$PLAIN"; mcp_raw "$(call 2 kinet_find_todos '{}')" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.content[0].text);console.log("total="+o.total,"missing="+o.missingTicket,o.results.map(r=>r.file+":"+r.line).join(","))})'
```
Expected: `total=5 missing=3 src/a.js:1,src/a.js:2,src/a.js:3,src/a.js:4,src/a.js:6`. No `node_modules/x/i.js` and no `bin.dat`.

### TC-38 run_script list mode runs nothing. AC-4.1
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_run_script '{}')"`
Expected: `isError=false`. The text starts with `scripts in package.json (5):` and lists `ok`, `fail`, `slow`, `loud`, `env` with their commands. The suite (TC-1) checks that nothing runs (a marker file is not created).

### TC-39 run_script passing script. AC-4.2, AC-4.3
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_run_script '{"script":"ok"}')"`
Expected: `isError=false`. Text lines `script: ok`, `command: node -e "console.log(42)"`, `exit code: 0`, `duration: <n> s`, `--- output ---`, and `42` in the output.

### TC-40 run_script failing script is a normal result, and the server survives. AC-4.5
Steps: `cd "$FX"; MCP_MAX=2000 mcp_rpc "$(call 2 kinet_run_script '{"script":"fail"}')" "$(list 3)"`
Expected: id=2 `isError=false` with `exit code: 3` and `boom` in the output. id=3 `tools=14`, so the same server is still answering.

### TC-41 run_script timeout kills the process group. AC-4.4
```bash
cd "$FX"; MCP_WAIT=5 MCP_MAX=2000 mcp_rpc "$(call 2 kinet_run_script '{"script":"slow","timeoutSeconds":2}')"
pgrep -f 'setTimeout\(\(\)=>\{\},60000\)' ; echo "orphans-exit=$?"
```
Expected: the text has `result: timed out after 2 s; process group killed` and `duration: 2.0 s` (±0.2). `orphans-exit=1`, so no orphan grandchild.

### TC-42 run_script long output keeps the tail. AC-4.3, AC-0.4
```bash
cd "$FX"; MCP_WAIT=8 mcp_raw "$(call 2 kinet_run_script '{"script":"loud"}')" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.content[0].text;console.log("len="+t.length,"earlier="+/\[truncated: \d+ earlier lines\]/.test(t),"tail="+/line 49999\s*$/.test(t),"exit0="+t.includes("exit code: 0"))})'
```
Expected: `len=` ≤ 20000, `earlier=true`, `tail=true`, `exit0=true`.

### TC-43 Scripts never see `KINET_MCP_TOKEN` (design: review-2 finding 4)
Steps: `cd "$FX"; KINET_MCP_TOKEN=$(openssl rand -hex 32) MCP_MAX=2000 mcp_rpc "$(call 2 kinet_run_script '{"script":"env"}')"`
Expected: the output contains `token=undefined`.

### TC-44 Tools run asynchronously: the server answers while a script runs. AC-0.9 (behaviour)
Steps: `cd "$FX"; MCP_ORDER=1 MCP_WAIT=5 mcp_rpc "$(call 2 kinet_run_script '{"script":"slow","timeoutSeconds":3}')" "$(list 3)" "$(call 4 kinet_git_status '{}')"`
Expected: the first line is `arrival order: 3,4,2` (or `4,3,2`). id=2 arrives last, about 3 s later, with `timed out`.

### TC-45 check_deps with no lockfile and no deps. AC-5.3, AC-5.5
```bash
cd "$FX"; sum0=$(shasum package.json)
MCP_WAIT=20 MCP_MAX=2000 mcp_rpc "$(call 2 kinet_check_deps '{}')"
[ "$sum0" = "$(shasum package.json)" ] && echo PKG-UNCHANGED; test ! -e package-lock.json && echo NO-LOCKFILE
```
Expected: `isError=false`. JSON `{"outdated":{"count":0,"packages":[]},"audit":{"error":"could not check: no lockfile (run npm install to create one)"}}` (pretty-printed). Then `PKG-UNCHANGED`, `NO-LOCKFILE`.

### TC-46 check_deps section selection. AC-5.3
Steps: `cd "$FX"; MCP_WAIT=20 MCP_MAX=2000 mcp_rpc "$(call 2 kinet_check_deps '{"check":"audit"}')" "$(call 3 kinet_check_deps '{"check":"outdated"}')" "$(call 4 kinet_check_deps '{"check":"bogus"}')"`
Expected: id=2 has only the `audit` key. id=3 has only the `outdated` key. id=4 `isError=true "Error: check must be one of: outdated, audit, all"`.

### TC-47 check_deps with an unreachable registry. AC-5.5, AC-5.4
```bash
cd "$R"; sum0=$(shasum package.json package-lock.json)
npm_config_registry=http://127.0.0.1:9 npm_config_fetch_retries=0 npm_config_fetch_timeout=2000 MCP_WAIT=30 MCP_MAX=2000 mcp_rpc "$(call 2 kinet_check_deps '{}')"
[ "$sum0" = "$(shasum package.json package-lock.json)" ] && echo BYTE-IDENTICAL
```
Expected: `isError=false`. Each section is either data or `{"error":"could not check: …"}` with readable text (e.g. `registry unreachable (ECONNREFUSED)`). There is no stack trace, and `BYTE-IDENTICAL` is printed. The suite covers the same case in a fixture (TC-1).

### TC-48 check_deps against the real registry (network). AC-5.1, AC-5.2, AC-5.4
```bash
cd "$R"; sum0=$(shasum package.json package-lock.json)
MCP_WAIT=60 mcp_raw "$(call 2 kinet_check_deps '{}')" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d.trim().split("\n").map(JSON.parse).find(m=>m.id===2).result.content[0].text);console.log("outdated:",o.outdated.error??o.outdated.count, JSON.stringify(o.outdated.packages?.[0]));console.log("audit:",JSON.stringify(o.audit.counts??o.audit.error), JSON.stringify(o.audit.packages?.slice(0,3)))})'
[ "$sum0" = "$(shasum package.json package-lock.json)" ] && echo BYTE-IDENTICAL
```
Expected: if there are outdated packages, each has `name`, `current`, `wanted`, `latest` and `type` ∈ {prod, dev, optional, peer, transitive}. `audit.counts` has `critical, high, moderate, low, info, total`. Each package has `name, severity, direct, fixAvailable`. `BYTE-IDENTICAL` is printed. Mark **BLOCKED (network)** if both sections report registry errors. Canned-JSON parser coverage is in TC-1.

### TC-49 Not a git repo / no package.json. AC-0.3
Steps: `cd "$PLAIN"; MCP_WAIT=4 mcp_rpc "$(call 2 kinet_git_status '{}')" "$(call 3 kinet_git_diff '{}')" "$(call 4 kinet_run_script '{}')" "$(call 5 kinet_check_deps '{}')"`
Expected: all `isError=false`:
- id=2 `Not a git repository: /private/tmp/kinet-tsr/plain. kinet_git_status needs a git work tree.`
- id=3 the same, naming `kinet_git_diff`
- id=4 `No package.json in /private/tmp/kinet-tsr/plain; kinet_run_script needs an npm project.`
- id=5 the same, naming `kinet_check_deps`

---

## 6. Tool-argument negatives

### TC-55 Option injection through `ref`. AC-0.8a
```bash
cd "$FX"; mcp_rpc "$(call 2 kinet_git_diff '{"scope":"ref","ref":"--output=/tmp/kinet-tsr/pwn1"}')" "$(call 3 kinet_git_diff '{"scope":"working","ref":"--output=/tmp/kinet-tsr/pwn1"}')"
test ! -e /tmp/kinet-tsr/pwn1 && echo NO-FILE
```
Expected: both `isError=true "Error: Refusing ref \"--output=/tmp/kinet-tsr/pwn1\": values starting with \"-\" are not allowed."` (ref is checked in every scope). `NO-FILE`.

### TC-56 Option injection through `path`. AC-0.8a
Steps: `cd "$FX"; mcp_rpc "$(call 2 kinet_git_diff '{"path":"-x"}')" "$(call 3 kinet_find_todos '{"path":"--output=/tmp/kinet-tsr/pwn1"}')" "$(call 4 kinet_run_script '{"script":"-v"}')"; test ! -e /tmp/kinet-tsr/pwn1 && echo NO-FILE`
Expected: ids 2 and 3 are `isError=true` with `Refusing path "…": values starting with "-" are not allowed.`. id=4 is `isError=true`, refused (leading dash or unknown script). `NO-FILE`.

### TC-57 Path escape. AC-0.8c. *Changes FX: adds a symlink, removed at the end of the case.*
```bash
cd "$FX"; ln -s /etc etclink
mcp_rpc "$(call 2 kinet_git_diff '{"path":"../.."}')" "$(call 3 kinet_git_diff '{"path":"/etc"}')" "$(call 4 kinet_find_todos '{"path":"../.."}')" "$(call 5 kinet_find_todos '{"path":"/etc"}')" "$(call 6 kinet_find_todos '{"path":"etclink"}')" "$(call 7 kinet_git_diff '{"path":"src/../../.."}')"
rm etclink; git status --porcelain | grep -c etclink
```
Expected: ids 2-7 are all `isError=true "Error: Refusing path \"<value>\": it is outside the project directory."`. The final count is `0`, so FX is restored.

### TC-58 Shell metacharacters are never executed. AC-0.5
```bash
cd "$FX"; mcp_rpc "$(call 2 kinet_git_diff '{"scope":"ref","ref":"main; touch /tmp/kinet-tsr/pwn2"}')" "$(call 3 kinet_git_diff '{"scope":"ref","ref":"$(touch /tmp/kinet-tsr/pwn3)"}')" "$(call 4 kinet_find_todos '{"path":"src; touch /tmp/kinet-tsr/pwn4"}')"
ls /tmp/kinet-tsr | grep -c '^pwn'
```
Expected: id=2 `Unknown ref "main; touch /tmp/kinet-tsr/pwn2": not a commit in this repository.`. id=3 likewise names the literal `$(touch …)` ref. id=4 `Path not found: …`. The count is `0`.

### TC-59 Only declared scripts run. AC-4.2, AC-0.5
```bash
cd "$FX"; mcp_rpc "$(call 2 kinet_run_script '{"script":"x; touch /tmp/kinet-tsr/pwn5"}')" "$(call 3 kinet_run_script '{"script":"__proto__"}')" "$(call 4 kinet_run_script '{"script":"toString"}')" "$(call 5 kinet_run_script '{"script":"OK"}')"
ls /tmp/kinet-tsr | grep -c '^pwn'
```
Expected: all `isError=true "Error: Unknown script \"<name>\". Valid scripts: ok, fail, slow, loud, env"`. The count is `0`.

### TC-60 Unknown tool name (regression of the dispatcher default)
Steps: `cd "$FX"; mcp_rpc "$(call 2 kinet_nope '{}')"`
Expected: `id=2 isError=true "Error: Unknown tool: kinet_nope"`.

### TC-61 find_todos on a missing path
Steps: `cd "$FX"; mcp_rpc "$(call 2 kinet_find_todos '{"path":"nope"}')"`
Expected: `isError=false "Path not found: nope"`.

### TC-64 Only one script runs at a time (design §4.4)
Steps: `cd "$FX"; MCP_WAIT=4 MCP_MAX=200 mcp_rpc "$(call 2 kinet_run_script '{"script":"slow","timeoutSeconds":2}')" "$(call 3 kinet_run_script '{"script":"ok"}')"`
Expected: `id=2 isError=false "script: slow … result: timed out after 2 s; process group killed …"` and `id=3 isError=false "A script is already running (slow); wait for it to finish."`. `slow` holds the slot for 2 s, so the result does not depend on timing.

### TC-62 Pathspec magic is taken literally (06-security finding 3). AC-0.8c
Steps: `cd "$FX/src"; MCP_MAX=300 mcp_rpc "$(call 2 kinet_git_diff '{"path":":/"}')" "$(call 3 kinet_git_diff '{"path":":(top)package.json"}')" "$(call 4 kinet_find_todos '{"path":":/"}')" "$(call 5 kinet_git_diff '{"path":"*.js"}')" "$(call 6 kinet_git_diff '{}')"` (the server's cwd is a subdirectory of the repo)
Expected:
- ids 2, 3 and 5: `No changes (…)`. The magic did not widen the scope to the repo root or a glob. Without the fix, `:/` would show `src/c.js`.
- id=4: `Path not found: :/`
- id=6 (control, no path): shows `src/c.js`, so the diff itself works.

### TC-63 A hostile `.git/config` never runs commands (review-6b finding 1, 06-security). AC-0.5. *Uses a copy of FX; FX is not touched.*
```bash
rm -rf "$TSR/hostile" "$TSR/hmark" && cp -R "$FX" "$TSR/hostile" && mkdir "$TSR/hmark" && cd "$TSR/hostile"
for h in fsmonitor textconv external; do printf '#!/bin/sh\ntouch %s/%s-ran\ncat "$1" 2>/dev/null\n' "$TSR/hmark" $h > "$TSR/hmark/$h.sh"; chmod +x "$TSR/hmark/$h.sh"; done
git config core.fsmonitor "$TSR/hmark/fsmonitor.sh"; git config diff.external "$TSR/hmark/external.sh"; git config diff.evil.textconv "$TSR/hmark/textconv.sh"; printf '*.js diff=evil\n' > .gitattributes
mcp_rpc "$(call 2 kinet_git_status '{}')" "$(call 3 kinet_git_diff '{}')" "$(call 4 kinet_git_diff '{"scope":"staged"}')" "$(call 5 kinet_git_diff '{"scope":"ref","ref":"main"}')" "$(call 6 kinet_find_todos '{}')" | cut -c1-100
ls "$TSR/hmark" | grep -c -- '-ran'
git status >/dev/null 2>&1; ls "$TSR/hmark" | grep -- '-ran'
```
Expected: 5 normal results (`branch: feature`, `src/c.js` diff, `src/staged.js` diff, `src/b.js` diff, `total` 5/3), then `0`, so none of the hooks ran. The last line is a control: plain `git status` prints `fsmonitor-ran`, which proves the fixture really is hostile. `filter.<name>.clean` is a documented, accepted risk (README) and is not tested.

---

## 7. CLI lifecycle (FX). Run in this order

### TC-70 status before any start creates nothing. AC-8.2, AC-8.4
Steps: `source /tmp/kinet-tsr/env.sh; cd "$FX"; node "$K" mcp status; echo "exit=$?"; test ! -e .kinet && echo NO-KINET-DIR`
Expected: `stopped`, `exit=1`, `NO-KINET-DIR`.

### TC-71 logs before any start. AC-10.4
Steps: `cd "$FX"; node "$K" mcp logs; echo "exit=$?"`
Expected: stderr `Error: no logs — has \`kinet mcp start\` been run? (looked for /private/tmp/kinet-tsr/fx/.kinet/run/mcp.log)` (the path may show as `/tmp/...`). `exit=1`.

### TC-72 start on the default port. AC-7.1, AC-7.2
Precondition: `port_free 7345`.
Steps: `cd "$FX"; /usr/bin/time -p node "$K" mcp start; echo "exit=$?"`
Expected: `exit=0`, `real` < 5 s (dry run: 0.15 s). stdout:
```
KINET MCP server started
  pid:  <n>
  port: 7345
  url:  http://127.0.0.1:7345/sse
  log:  /…/fx/.kinet/run/mcp.log
```
Note: AC-7.2 says `http://localhost:<port>/sse`. Design §5.2 prints `127.0.0.1`, which is accepted because the server binds IPv4 only. Not a defect.

### TC-73 Run state, gitignore, detachment. AC-7.1, AC-7.3
```bash
cd "$FX"; ls -a .kinet/run; cat .kinet/run/.gitignore; stat -f '%Lp %N' .kinet/run/mcp.json .kinet/run/mcp.log
git check-ignore -q .kinet/run/mcp.json && echo IGNORED; git status --porcelain | grep -c '\.kinet'
node -e 'const s=require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json");console.log(Object.keys(s).join(","), s.cwd, s.port, s.token.length)'
PID=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").pid'); ps -o pid,ppid,pgid,tty,command -p $PID
stat -f '%Lp %N' .kinet/run
```
Expected: `.gitignore`, `mcp.json`, `mcp.log` are present and there is no `mcp.lock`. `.gitignore` contains `*`. Both files are mode `600`, and the last line is `700 .kinet/run`. `IGNORED`, count `0`. Keys `pid,port,token,cwd,startedAt,logPath,version`, cwd `/private/tmp/kinet-tsr/fx`, port `7345`, token length `64`. ps shows PPID `1`, PGID = PID, TTY `??`, command `node …/bin/kinet.js mcp --port 7345`. The token is not in argv.

### TC-74 Second start reuses the running server. AC-7.4
Steps: `cd "$FX"; node "$K" mcp start; echo "exit=$?"; pgrep -f "kinet.js mcp --port 7345" | wc -l`
Expected: header `KINET MCP server already running` with the same pid as TC-72. `exit=0`, process count `1`.

### TC-75 status while running. AC-8.1
Steps: `cd "$FX"; node "$K" mcp status; echo "exit=$?"`
Expected: the first line is exactly `running`, followed by `pid:`, `port:   7345`, `url:    http://127.0.0.1:7345/sse`, `uptime: <n>s|<m>m <s>s`, and `log:`. `exit=0`.

### TC-76 Bound to 127.0.0.1 only. AC-7.6, AC-6.2
```bash
lsof -nP -iTCP:7345 -sTCP:LISTEN
curl -s -m 2 -o /dev/null -w '127.0.0.1 -> %{http_code}\n' -H 'X-Kinet-Token: x' http://127.0.0.1:7345/health
IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1); echo "lan=$IP"; curl -s -m 2 -o /dev/null -w 'lan -> %{http_code} %{errormsg}\n' "http://$IP:7345/health"
curl -s -m 2 -o /dev/null -w '::1 -> %{http_code} %{errormsg}\n' 'http://[::1]:7345/health'
```
Expected: exactly one LISTEN row, `TCP 127.0.0.1:7345 (LISTEN)` (not `*:7345` or `[::]`). `127.0.0.1 -> 401`. `lan -> 000 … Couldn't connect` (skip if there is no LAN IP). `::1 -> 000 … Couldn't connect`.

### TC-77 A real SSE session serves this project, and its tool calls are logged. AC-7.3, AC-10.3
```bash
cd "$FX"; sse_open 7345
sse_post 7345 "$INIT"; sse_post 7345 "$NOTE"; sse_post 7345 "$(list 2)"
sse_post 7345 "$(call 3 kinet_git_status '{}')"; sse_post 7345 "$(call 4 kinet_git_diff '{"path":"SECRET_ARG_123"}')"
sleep 1; MCP_MAX=120 sse_msgs; sse_close
TOKEN=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").token'); echo "$TOKEN" > /tmp/kinet-tsr/token-run1
```
Expected: endpoint `/messages?sessionId=<uuid>`. Every POST prints `202`. `id=2 tools=14 …`. id=3 text starts with `branch: feature`, so the server runs in FX. id=4 `isError=false` with `No changes`.

### TC-78 logs tail. AC-10.1
Steps: `cd "$FX"; node "$K" mcp logs -n 5; echo "exit=$?"; node "$K" mcp logs | wc -l; node "$K" mcp logs --lines 2 | wc -l`
Expected: 5 lines (including `INFO session open`, `INFO tool name=kinet_git_status ms=<n> result=ok`, `INFO tool name=kinet_git_diff …`, `INFO session close`). `exit=0`. The default count is ≤ 50 and equals the file's line count while that is under 50. `--lines 2` gives `2`.

### TC-79 logs -f streams until SIGINT. AC-10.2 (scripted proxy; the interactive version is TC-M3)
```bash
cd "$FX"; node "$K" mcp logs -f -n 1 > /tmp/kinet-tsr/follow.out 2>&1 & F=$!; sleep 0.7
echo "$(date -u +%FT%TZ) INFO tsr-follow-marker" >> .kinet/run/mcp.log; sleep 0.8
kill -INT $F; wait $F; echo "exit=$?"; grep -c tsr-follow-marker /tmp/kinet-tsr/follow.out
```
Expected: `exit=0`, count `1`.

### TC-80 status never changes anything. AC-8.4
```bash
cd "$FX"; m0=$(stat -f %m .kinet/run/mcp.json); p0=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").pid')
for i in 1 2 3; do node "$K" mcp status >/dev/null; done
[ "$m0" = "$(stat -f %m .kinet/run/mcp.json)" ] && kill -0 $p0 && pgrep -f "kinet.js mcp --port 7345" | wc -l
```
Expected: `1` (state file untouched, same single process).

### TC-81 Log holds no argument values or token. AC-10.3
Steps: `cd "$FX"; grep -c SECRET_ARG_123 .kinet/run/mcp.log; grep -c "$(cat /tmp/kinet-tsr/token-run1)" .kinet/run/mcp.log`
Expected: `0` and `0`.

### TC-82 stop. AC-9.1
```bash
cd "$FX"; PID=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").pid')
/usr/bin/time -p node "$K" mcp stop; echo "exit=$?"
kill -0 $PID 2>/dev/null; echo "alive-exit=$?"; port_free 7345 && echo PORT-FREE; test ! -e .kinet/run/mcp.json && echo STATE-CLEARED
node "$K" mcp status; echo "status-exit=$?"
```
Expected: `stopped (pid <PID>)`, `exit=0`, `real` well under 5 s (graceful). `alive-exit=1`, `PORT-FREE`, `STATE-CLEARED`, `stopped`, `status-exit=1`.

### TC-83 stop when nothing runs. AC-9.2
Steps: `cd "$FX"; node "$K" mcp stop; echo "exit=$?"`
Expected: `not running`, `exit=0`.

### TC-84 The log survives stop and has the lifecycle lines. AC-10.5, AC-10.3
Steps: `cd "$FX"; cat .kinet/run/mcp.log`
Expected, in order: `INFO start mode=daemon port=7345 pid=<n> cwd=/private/tmp/kinet-tsr/fx version=1.0.1`, `INFO listening http://127.0.0.1:7345/sse`, `INFO session open id=<8 hex>`, `INFO tool name=kinet_git_status ms=<n> result=ok`, `INFO tool name=kinet_git_diff ms=<n> result=ok`, `INFO session close`, the `tsr-follow-marker` line appended by TC-79, `WARN shutdown reason=http`. Every line starts with a timestamp.

### TC-85 start rotates the log. AC-10.5
```bash
cd "$FX"; node "$K" mcp start --port $P1 >/dev/null; echo "exit=$?"
grep -c 'shutdown reason=http' .kinet/run/mcp.log.1; head -1 .kinet/run/mcp.log; grep -c 'port=7345' .kinet/run/mcp.log
node "$K" mcp stop
```
Expected: `exit=0`, then `1` (the previous run is in `mcp.log.1`), then the first line of the new `mcp.log` is `… INFO start mode=daemon port=47311 …`, then `0`. Then `stopped (pid …)`. The 10 MB in-run cap is unit-tested (TC-1, log.test.js).

### TC-86 `--port` forwarding and precedence (design §5.1)
```bash
cd "$FX"; node "$K" mcp --port $P2 start | grep port:; node "$K" mcp stop
node "$K" mcp --port $P2 start --port $P1 | grep port:; node "$K" mcp stop
```
Expected: `port: 47312`, then `stopped …`, then `port: 47311` (the subcommand's value wins), then `stopped …`.

---

## 8. CLI negatives and robustness

### TC-90 Unknown subcommand. AC-6.6
```bash
cd "$FX"; /usr/bin/time -p node "$K" mcp foo; echo "exit=$?"; node "$K" mcp foo bar; echo "exit2=$?"
pgrep -fl "kinet.js mcp"; echo "none=$?"
```
Expected: stderr `error: unknown subcommand 'foo'. Valid: start, stop, status, logs` and `exit=1`, with `real` < 3 s. The same line again for `foo bar`, with `exit2=1`. Then `none=1` (nothing started).

### TC-87 Stray arguments on any subcommand are refused (F-6 fix; design §5.1, §5.6)
```bash
cd "$FX"
node "$K" mcp start 9000; echo "start exit=$?"
node "$K" mcp stop x;     echo "stop exit=$?"
node "$K" mcp status x;   echo "status exit=$?"
node "$K" mcp logs x;     echo "logs exit=$?"
pgrep -f "kinet.js mcp --port"; echo "no-daemon=$?"; test ! -e .kinet/run/mcp.json && echo NO-STATE
node "$K" mcp stop; echo "cleanup exit=$?"
```
Expected, exactly:
```
error: too many arguments for 'start'. Expected 0 arguments but got 1.
start exit=1
error: too many arguments for 'stop'. Expected 0 arguments but got 1.
stop exit=1
error: too many arguments for 'status'. Expected 0 arguments but got 1.
status exit=1
error: too many arguments for 'logs'. Expected 0 arguments but got 1.
logs exit=1
no-daemon=1
NO-STATE
not running
cleanup exit=0
```
The `error:` lines go to stderr. Dry run at `d5a94e3`: exactly this. Each command is on its own line because a bash loop over `"start 9000"` would pass a single argument.

### TC-91 Parent `--port` refused for stop/status/logs (design §5.1)
Steps: `cd "$FX"; for s in status stop logs; do node "$K" mcp --port 1 $s; echo "$s exit=$?"; done`
Expected: each prints `error: --port only applies to 'kinet mcp start' and foreground 'kinet mcp --port <n>'` and exits `1`.

### TC-92 Bad option values (design §2.2)
Steps: `cd "$FX"; for p in 80abc 0 70000 -1 1.5; do node "$K" mcp start --port "$p"; echo "port=$p exit=$?"; done; node "$K" mcp --port abc; echo "fg exit=$?"; node "$K" mcp logs -n 0; echo "n0 exit=$?"; node "$K" mcp logs -n abc; echo "nabc exit=$?"`
Expected: every line exits `1` with `error: option '--port <port>' argument '<v>' is invalid. must be an integer 1-65535` (or the `-n` equivalent `must be a positive integer`). `ls "$FX/.kinet/run"` shows no `mcp.json` or `mcp.lock`.

### TC-93 Port busy (127.0.0.1 holder). AC-7.5
```bash
cd "$FX"; node -e 'require("net").createServer().listen(+process.argv[1],"127.0.0.1")' $P_BUSY & H=$!; sleep 0.4
node "$K" mcp start --port $P_BUSY; echo "exit=$?"
ls -a .kinet/run | grep -E 'mcp\.(json|lock)$'; echo "no-state=$?"; pgrep -f "kinet.js mcp --port $P_BUSY"; echo "no-orphan=$?"; kill $H
```
Expected: stderr `Error: port 47313 is in use. Try: kinet mcp start --port <other>`, `exit=1`, `no-state=1`, `no-orphan=1`.

### TC-94 Port busy (wildcard `*:P` holder, e.g. a dev server on its default host). AC-7.5
```bash
cd "$FX"; node -e 'require("net").createServer(s=>s.end()).listen(+process.argv[1])' $P_WILD & H=$!; sleep 0.4
node "$K" mcp start --port $P_WILD; echo "exit=$?"; lsof -nP -iTCP:$P_WILD -sTCP:LISTEN | tail -n +2 | awk '{print $9}'
ls -a .kinet/run | grep -E 'mcp\.(json|lock)$'; echo "no-state=$?"; pgrep -f "kinet.js mcp --port $P_WILD"; echo "no-orphan=$?"
node "$K" mcp stop; kill $H
```
Expected: stderr `Error: port 47314 is in use. Try: kinet mcp start --port <other>`, `exit=1`. A single LISTEN row `*:47314` (the holder only). Then `no-state=1`, `no-orphan=1`, and the cleanup `stop` prints `not running`. F-2 is fixed (§13). Dry run at `d5a94e3`: exactly this.

### TC-95 Foreground `--port` on a busy port exits 3 (design §5.6)
Steps: `cd "$FX"; node -e 'require("net").createServer().listen(+process.argv[1],"127.0.0.1")' $P_BUSY & H=$!; sleep 0.4; node "$K" mcp --port $P_BUSY; echo "exit=$?"; kill $H`
Expected: stderr `… ERROR port 47313 is in use`, `exit=3`.

### TC-96 Stale state that points at an unrelated live process. AC-8.3, AC-9.2, AC-9.3
```bash
cd "$FX"; mkdir -p .kinet/run; node -e 'setTimeout(()=>{},60000)' & U=$!
w() { printf '{"pid":%s,"port":%s,"token":"%s","cwd":"%s","startedAt":"2026-10-25T00:00:00.000Z","logPath":"x","version":"1.0.1"}' $U $P_LOCK "$(openssl rand -hex 32)" "$PWD" > .kinet/run/mcp.json; }
w; node "$K" mcp status; echo "status-exit=$?"; test ! -e .kinet/run/mcp.json && echo CLEARED
w; node "$K" mcp stop; echo "stop-exit=$?"; kill -0 $U && echo UNRELATED-ALIVE; kill $U
```
Expected: `stopped (stale)`, `status-exit=1`, `CLEARED`. Then `not running (cleared stale state)`, `stop-exit=0`, `UNRELATED-ALIVE`.

### TC-97 Dead pid and corrupt state. AC-8.3
```bash
cd "$FX"; printf '{"pid":999999,"port":%s,"token":"x","cwd":"/x","startedAt":"2026-10-25T00:00:00.000Z"}' $P_LOCK > .kinet/run/mcp.json
node "$K" mcp status; echo "exit=$?"; test ! -e .kinet/run/mcp.json && echo CLEARED
printf '{not json' > .kinet/run/mcp.json; node "$K" mcp status; echo "exit=$?"; node "$K" mcp start --port $P1 | head -1; node "$K" mcp stop
```
Expected: `stopped (stale)`, `exit=1`, `CLEARED`. Corrupt file: `stopped`, `exit=1`. A following start succeeds (`KINET MCP server started`) and overwrites it. Then `stopped (pid …)`.

### TC-98 Another project's live KINET server in this project's state file. AC-9.3, AC-8.3
```bash
cd "$OTHER"; node "$K" mcp start --port $P_OTHER >/dev/null; OPID=$(node -p 'require("/tmp/kinet-tsr/other/.kinet/run/mcp.json").pid')
cd "$FX"; cp "$OTHER/.kinet/run/mcp.json" .kinet/run/mcp.json
node "$K" mcp status; echo "status-exit=$?"
cp "$OTHER/.kinet/run/mcp.json" .kinet/run/mcp.json; node "$K" mcp stop; echo "stop-exit=$?"
kill -0 $OPID && echo OTHER-ALIVE
cp "$OTHER/.kinet/run/mcp.json" .kinet/run/mcp.json; node "$K" mcp start --port $P1 > /tmp/kinet-tsr/s.out; echo "start-exit=$?"; head -2 /tmp/kinet-tsr/s.out
FPID=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").pid'); [ "$FPID" != "$OPID" ] && echo DIFFERENT-PID
(cd "$OTHER" && node "$K" mcp status | head -1); node "$K" mcp stop
```
Expected (AC-9.3: signal only after confirming it is **this project's** server; design §5.3: identity requires the state and `/health` `cwd` to equal this directory's realpath):
```
stopped (stale)
status-exit=1
not running (cleared stale state)
stop-exit=0
OTHER-ALIVE
start-exit=0
KINET MCP server started
  pid:  <FX's own pid>
DIFFERENT-PID
running
stopped (pid <FX's own pid>)
```
So `start` launches FX's own server (not `already running`), OTHER stays `running`, and OTHER is left running for TC-102. F-5 is fixed (§13). Dry run at `d5a94e3`: exactly this.

### TC-99 Start locks (design: review-2 finding 2). AC-7.5
```bash
cd "$FX"; now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
printf '{"pid":999999,"createdAt":"%s"}' "$(now)" > .kinet/run/mcp.lock
node "$K" mcp start --port $P_LOCK | head -1; echo "dead-lock exit=${PIPESTATUS[0]}"; test ! -e .kinet/run/mcp.lock && echo LOCK-GONE; node "$K" mcp stop
node -e 'setTimeout(()=>{},30000)' & U=$!; printf '{"pid":%s,"createdAt":"%s"}' $U "$(now)" > .kinet/run/mcp.lock
node "$K" mcp start --port $P_LOCK; echo "live-lock exit=$?"; test -e .kinet/run/mcp.lock && echo LOCK-KEPT
printf '{"pid":%s,"createdAt":"2026-10-25T00:00:00.000Z"}' $U > .kinet/run/mcp.lock
node "$K" mcp start --port $P_LOCK | head -1; echo "old-lock exit=${PIPESTATUS[0]}"; node "$K" mcp stop; kill $U
printf 'garbage' > .kinet/run/mcp.lock; touch -t 202601010000 .kinet/run/mcp.lock; node "$K" mcp start --port $P_LOCK | head -1; node "$K" mcp stop
```
Expected:
- dead-pid lock: `KINET MCP server started`, `exit=0`, `LOCK-GONE`
- live fresh lock: `Error: another 'kinet mcp start' is running for this project (pid <U>).`, `exit=1`, `LOCK-KEPT`
- lock older than 10 s with a live pid: started, `exit=0`
- old unparseable lock: started
- every stop: `stopped (pid …)`

### TC-100 Two starts at the same moment
```bash
cd "$FX"; node "$K" mcp start --port $P1 > /tmp/kinet-tsr/c1 2>&1 & A=$!; node "$K" mcp start --port $P1 > /tmp/kinet-tsr/c2 2>&1 & B=$!
wait $A; ea=$?; wait $B; eb=$?; echo "A=$ea $(head -1 /tmp/kinet-tsr/c1)"; echo "B=$eb $(head -1 /tmp/kinet-tsr/c2)"
pgrep -f "kinet.js mcp --port $P1" | wc -l; node "$K" mcp stop
```
Expected: exactly one daemon (count `1`). One of the two prints `KINET MCP server started` with exit 0. The other prints `KINET MCP server already running` (exit 0) or `Error: another 'kinet mcp start' is running …` (exit 1, the designed lock behaviour). Then `stopped (pid …)`.

### TC-101 A hung (unresponsive) daemon. AC-9.1, AC-8.3 (design §5.2 step 2, §5.3 block U, §5.4, §5.6)
`SIGSTOP` is a deterministic stand-in for a blocked event loop or a slow wake from sleep. The `unresponsive` state, block U, exit 2 and the forced stop are the accepted design change for F-1, recorded in 03-design §5.3/§5.4/§5.6.
```bash
cd "$FX"; node "$K" mcp start --port $P_FRZ >/dev/null; PID=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").pid'); kill -STOP $PID
node "$K" mcp status; echo "status-exit=$?"; test -e .kinet/run/mcp.json && echo STATE-KEPT || echo STATE-DELETED
node "$K" mcp start --port $P_FRZ; echo "start-exit=$?"
/usr/bin/time -p node "$K" mcp stop; echo "stop-exit=$?"; kill -0 $PID 2>/dev/null && echo STILL-ALIVE || echo GONE
port_free $P_FRZ && echo PORT-FREE || echo PORT-HELD; test ! -e .kinet/run/mcp.json && echo STATE-CLEARED
node "$K" mcp status; echo "status2-exit=$?"
# cleanup, whatever the outcome
kill -CONT $PID 2>/dev/null; kill $PID 2>/dev/null; sleep 1; pgrep -f "kinet.js mcp --port $P_FRZ"; echo "cleaned=$?"
```
Expected, exactly (pid and paths vary):
```
unresponsive
  pid:    <PID>
  port:   47316
  log:    /private/tmp/kinet-tsr/fx/.kinet/run/mcp.log
  hint:   the process is alive but /health did not answer; run `kinet mcp stop` to force-kill it
status-exit=2
STATE-KEPT
Error: the MCP server for this project (pid <PID>) is not responding. Run: kinet mcp stop
start-exit=1
stopped (pid <PID>, force-killed after 5 s)
real <5.0-8.0>
stop-exit=0
GONE
PORT-FREE
STATE-CLEARED
stopped
status2-exit=1
cleaned=1
```
- The `Error:` line goes to stderr.
- `real` must be between 5 and 8 s. Dry run: 7.15 s, which is the 1 s `/health` probe, plus the 1 s `/shutdown` timeout, plus the 5 s grace. Less than 5 s means it did not wait the grace period.
- Dry run at `d5a94e3`: exactly this.

### TC-106 A hung-looking decoy that is not ours is never signalled (review-6a #2). AC-9.3, AC-8.3 (design §5.3 "Confirming a hung pid is ours", §5.4 step 2)
The decoy accepts TCP connections on the state's port but never answers HTTP, so `/health` times out exactly as for a hung daemon. Variant A has an old `startedAt`, so both the command-line check and the start-time check fail. Variant B uses a `startedAt` after the decoy started, so only the command-line check (`kinet.js mcp --port <port>`) can reject it.
```bash
cd "$FX"; mkdir -p .kinet/run
node -e 'require("net").createServer(()=>{}).listen(+process.argv[1],"127.0.0.1")' $P_LOCK & D=$!; sleep 1.5
w() { printf '{"pid":%s,"port":%s,"token":"%s","cwd":"%s","startedAt":"%s","logPath":"x","version":"1.0.1"}' $D $P_LOCK "$(openssl rand -hex 32)" "$PWD" "$1" > .kinet/run/mcp.json; }
w 2026-10-25T00:00:00.000Z; node "$K" mcp status; echo "A status-exit=$?"; test ! -e .kinet/run/mcp.json && echo A-CLEARED
w 2026-10-25T00:00:00.000Z; node "$K" mcp stop;   echo "A stop-exit=$?";   kill -0 $D && echo A-DECOY-ALIVE
w "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"; node "$K" mcp status; echo "B status-exit=$?"
w "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"; node "$K" mcp stop;   echo "B stop-exit=$?";   kill -0 $D && echo B-DECOY-ALIVE
kill $D
```
Expected, exactly:
```
stopped (stale)
A status-exit=1
A-CLEARED
not running (cleared stale state)
A stop-exit=0
A-DECOY-ALIVE
stopped (stale)
B status-exit=1
not running (cleared stale state)
B stop-exit=0
B-DECOY-ALIVE
```
Neither `unresponsive` nor `force-killed` may appear. The decoy is alive after both stops. Dry run at `d5a94e3`: exactly this.

### TC-102 Two projects at once. AC-7.3
```bash
(cd "$OTHER" && node "$K" mcp start --port $P_OTHER | head -1)   # self-contained: TC-98 may have left OTHER stopped
cd "$FX"; node "$K" mcp start --port $P_OTHER; echo "same-port exit=$?"
node "$K" mcp start --port $P1 | head -1; (cd "$OTHER" && node "$K" mcp status | head -1)
node "$K" mcp stop; (cd "$OTHER" && node "$K" mcp status | head -1 && node "$K" mcp stop)
```
Expected: OTHER prints `KINET MCP server started` or `… already running`. Then `Error: port 47318 is in use …`, `same-port exit=1`. FX then starts on 47311, and OTHER still says `running`. Stopping FX leaves OTHER `running`. Then OTHER stops (`stopped (pid …)`).

### TC-103 Invalid `KINET_MCP_TOKEN` (design §2.6)
Steps: `cd "$FX"; KINET_MCP_TOKEN=abc node "$K" mcp </dev/null; echo "exit=$?"; KINET_MCP_TOKEN=abc node "$K" mcp --port $P1; echo "exit=$?"`
Expected: both print `Error: KINET_MCP_TOKEN must be 64 hex characters` and exit `1`. Nothing listens on 47311.

### TC-104 Daemon killed outside kinet (SIGTERM). AC-8.3, AC-10.3
Steps: `cd "$FX"; node "$K" mcp start --port $P1 >/dev/null; PID=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").pid'); kill -TERM $PID; sleep 1; tail -1 .kinet/run/mcp.log; node "$K" mcp status; echo "exit=$?"`
Expected: the last log line is `WARN shutdown reason=SIGTERM`. `stopped (stale)`, `exit=1`.

### TC-105 Symlinked `.kinet` or `.kinet/run` is refused (06-security finding 1). AC-7.3
```bash
rm -rf "$TSR/symfx" "$TSR/symtarget"; mkdir -p "$TSR/symfx" "$TSR/symtarget"; cd "$TSR/symfx"
ln -s "$TSR/symtarget" .kinet; node "$K" mcp start --port $P1; echo "exit=$?"; ls -A "$TSR/symtarget" | wc -l
rm .kinet; mkdir .kinet; ln -s "$TSR/symtarget" .kinet/run; node "$K" mcp start --port $P1; echo "exit=$?"; ls -A "$TSR/symtarget" | wc -l
pgrep -f "kinet.js mcp --port $P1"; echo "no-daemon=$?"
```
Expected: `Error: refusing to use /private/tmp/kinet-tsr/symfx/.kinet: it is a symlink. Remove it and try again.`, `exit=1`, `0`. Then the same for `…/.kinet/run`, `exit=1`, `0`. Finally `no-daemon=1`. Nothing is written through the link.

---

## 9. HTTP routes and guard

Precondition: `cd "$FX"; node "$K" mcp start --port $P1 >/dev/null; TOKEN=$(node -p 'require("/tmp/kinet-tsr/fx/.kinet/run/mcp.json").token')`. All of TC-110 to TC-112 go in one shell after that precondition, and the last step is `node "$K" mcp stop`.

### TC-110 Host guard (DNS-rebinding defence). Security open question §8 / design D8
```bash
for h in "evil.example:$P1" "127.0.0.1" "localhost:$P1" "127.0.0.1:$P1"; do printf '%-22s ' "$h"; curl -s -m 1 -o /dev/null -w '%{http_code}\n' -H 'Accept: text/event-stream' -H "Host: $h" "http://127.0.0.1:$P1/sse"; done
```
Expected: `evil.example:47311 403`, `127.0.0.1 403` (no port), `localhost:47311 200`, `127.0.0.1:47311 200` (curl prints 200 when its 1 s timeout ends the stream). A 403 body reads `Forbidden host`.

### TC-111 Origin guard
```bash
for o in "http://evil.example" "http://localhost:$P1" "http://127.0.0.1:$P1" "null"; do printf '%-26s ' "$o"; curl -s -m 1 -o /dev/null -w '%{http_code}\n' -H 'Accept: text/event-stream' -H "Origin: $o" "http://127.0.0.1:$P1/sse"; done
```
Expected: `http://evil.example 403`, `http://localhost:47311 200`, `http://127.0.0.1:47311 200`, `null 403`.

### TC-112 Token-gated and unknown routes
```bash
c() { curl -s -m 2 -o /tmp/kinet-tsr/body -w "%{http_code}" "$@"; echo " $(head -c 200 /tmp/kinet-tsr/body)"; }
c "http://127.0.0.1:$P1/health"; c -H 'X-Kinet-Token: wrong' "http://127.0.0.1:$P1/health"; c -H "X-Kinet-Token: $TOKEN" "http://127.0.0.1:$P1/health"
c -X POST -H 'X-Kinet-Token: wrong' "http://127.0.0.1:$P1/shutdown"; c "http://127.0.0.1:$P1/nope"; c -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$P1/messages?sessionId=nope"
c -X GET "http://127.0.0.1:$P1/shutdown"; node "$K" mcp status | head -1; node "$K" mcp stop
```
Expected, in order:
- `401 {"error":"unauthorized"}` (twice)
- `200 {"pid":<n>,"cwd":"/private/tmp/kinet-tsr/fx","startedAt":"<ISO>","version":"1.0.1","sessions":0}`
- `401` for the wrong-token shutdown
- `404` for `/nope`
- `404 Unknown session`
- `404` for GET `/shutdown`
- status still `running` (nothing above stopped it), then `stopped (pid …)`

### TC-113 Foreground `kinet mcp --port`. AC-6.2
```bash
cd "$FX"; node "$K" mcp --port $P_FG 2>/tmp/kinet-tsr/fg.err & F=$!; sleep 0.6
lsof -nP -iTCP:$P_FG -sTCP:LISTEN | tail -1
curl -s -o /dev/null -w 'health %{http_code}\n' -H 'X-Kinet-Token: x' "http://127.0.0.1:$P_FG/health"
curl -s -o /dev/null -w 'shutdown %{http_code}\n' -X POST "http://127.0.0.1:$P_FG/shutdown"
sse_open $P_FG; sse_post $P_FG "$INIT"; sse_post $P_FG "$(list 2)"; sleep 0.5; sse_msgs; sse_close
kill -INT $F; wait $F; echo "exit=$?"; cat /tmp/kinet-tsr/fg.err; ls "$FX/.kinet/run" | grep -c mcp.json
```
Expected: LISTEN `127.0.0.1:47315`. `health 404`, `shutdown 404` (no daemon token). Both POSTs `202`, `id=2 tools=14`. `exit=0`. stderr has `INFO start mode=http port=47315`, `INFO listening http://127.0.0.1:47315/sse` and `WARN shutdown reason=SIGINT`. The final count is `0` (foreground mode writes no run state). Two concurrent SSE clients are covered by TC-1.

### TC-114 Session cap (design §6, 16 sessions)
```bash
cd "$FX"; node "$K" mcp start --port $P1 >/dev/null
for i in $(seq 1 16); do curl -sN -H 'Accept: text/event-stream' "http://127.0.0.1:$P1/sse" >/dev/null & done; sleep 1
curl -s -m 1 -o /dev/null -w '17th %{http_code}\n' -H 'Accept: text/event-stream' "http://127.0.0.1:$P1/sse"
kill $(jobs -p) 2>/dev/null; wait 2>/dev/null; node "$K" mcp stop
```
Expected: `17th 503`. Then `stopped (pid …)`.

### TC-115 `/sse` needs an event-stream Accept header, and cross-site fetches are refused (06-security finding 4)
```bash
cd "$FX"; node "$K" mcp start --port $P1 >/dev/null
curl -s -m 1 -o /tmp/kinet-tsr/body -w 'no-accept %{http_code} ' "http://127.0.0.1:$P1/sse"; cat /tmp/kinet-tsr/body; echo
for s in cross-site same-site same-origin none; do curl -s -m 1 -o /dev/null -w "sec-fetch-site=$s %{http_code}\n" -H 'Accept: text/event-stream' -H "Sec-Fetch-Site: $s" "http://127.0.0.1:$P1/sse"; done
node "$K" mcp stop
```
Expected: `no-accept 406 Accept must include text/event-stream`. Then `cross-site 403`, `same-site 403`, `same-origin 200`, `none 200`. Then `stopped (pid …)`.

---

## 10. Regression

### TC-120 The 9 core tools answer exactly as on develop. AC-0.1 (unchanged), 01 §9
```bash
source /tmp/kinet-tsr/env.sh
git -C "$R" worktree add -q "$TSR/wt-dev" develop && ln -s "$R/node_modules" "$TSR/wt-dev/node_modules"
REQS=("$(list 2)" "$(call 3 kinet_get_context '{}')" "$(call 4 kinet_get_rules '{}')" "$(call 5 kinet_get_prp '{}')" "$(call 6 kinet_get_prp '{"section":"patterns"}')" "$(call 7 kinet_memory_recall '{"query":"mcp"}')" "$(call 8 kinet_get_skill '{"skill":"security"}')" "$(call 9 kinet_validate '{}')" "$(call 10 kinet_get_skill '{"skill":"nope"}')")
for side in dev branch; do BIN=$([ $side = dev ] && echo "$TSR/wt-dev/bin/kinet.js" || echo "$K")
  (cd "$KFX" && { printf '%s\n' "$INIT" "$NOTE" "${REQS[@]}"; sleep 4; } | node "$BIN" mcp 2>/dev/null \
   | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const m of d.trim().split("\n").map(JSON.parse).filter(m=>m.id>1).sort((a,b)=>a.id-b.id)){if(m.id===2)m.result.tools=m.result.tools.slice(0,9);console.log(JSON.stringify(m))}})' > "$TSR/core-$side.jsonl")
done
wc -l "$TSR"/core-*.jsonl; diff "$TSR/core-dev.jsonl" "$TSR/core-branch.jsonl" && echo IDENTICAL
git -C "$R" worktree remove --force "$TSR/wt-dev"; git -C "$R" worktree prune
```
Expected: 9 lines each and `IDENTICAL`. That covers the first 9 tool definitions and the outputs of get_context, get_rules, get_prp (all, and one section), memory_recall, get_skill (found and not found) and validate. The worktree is removed afterwards, and `git -C "$R" worktree list` shows one entry. Dry run: IDENTICAL.

### TC-121 Network core tools still answer (network)
Steps: `cd "$KFX"; MCP_WAIT=15 mcp_rpc "$(call 2 kinet_web_search '{"query":"node test runner","maxResults":2}')" "$(call 3 kinet_github_search '{"query":"modelcontextprotocol typescript-sdk"}')"`
Expected: each id returns either results or a readable `Error: …` / rate-limit message, and stdout is still valid JSON-RPC. No crash. **BLOCKED (network)** if offline. These tools did not change (`git diff develop...HEAD -- src/mcp/tools/web-search.js src/mcp/tools/github-search.js` is empty).

### TC-122 memory_save → memory_recall round trip (writes only into KFX)
Steps: `cd "$KFX"; mcp_rpc "$(call 2 kinet_memory_save '{"title":"tsr probe","body":"tsr-roundtrip-token","id":"tsr-probe"}')"; mcp_rpc "$(call 3 kinet_memory_recall '{"query":"tsr probe"}')"`
Expected: `Memory saved: tsr-probe`, then id=3 returns the entry with `"title": "tsr probe"` and body `tsr-roundtrip-token`. Recall matches on the **title** (and tags) only. That is unchanged existing behaviour: a body-text query returns `[]`.

### TC-123 `kinet init` still writes `args: ['mcp']`, and other commands work. AC-6.4
```bash
source /tmp/kinet-tsr/env.sh; rm -rf "$TSR/initfx"; mkdir -p "$TSR/initfx" && cd "$TSR/initfx" && printf '{"name":"i","version":"1.0.0"}\n' > package.json && git init -q -b main
node "$K" init -y >/dev/null 2>&1; echo "init-exit=$?"; node -p 'JSON.stringify(require("./.claude/settings.json").mcpServers.kinet)'
node "$K" status >/dev/null; echo "status-exit=$?"; node "$K" validate >/dev/null; echo "validate-exit=$?"; node "$K" update --help >/dev/null; echo "update-help-exit=$?"
```
Expected: `init-exit=0`, `{"command":"kinet","args":["mcp"],"env":{}}`, `status-exit=0`, `validate-exit=0`, `update-help-exit=0`.

### TC-124 `kinet status` and `kinet validate` on the repo
Steps: `cd /Users/sjain/dev/personal/kinet && node bin/kinet.js status; echo "exit=$?"; node bin/kinet.js validate >/dev/null; echo "exit=$?"`
Expected: both `exit=0`. status prints installation health with no MCP state mixed in (01 §9). `validate` exits 1 whenever violations exist, so this depends on TC-3 (`violations=0`; F-4 is fixed).

### TC-125 `kinet update`, `kinet refresh` and `--version` still work (review-6a #5)
The branch touches `src/cli/update.js`, `src/cli/init.js`, `src/context/distiller.js`, `src/rules/engine.js`, `src/prp/system.js` and `src/rules/validators/common.js`, and adds `enablePositionalOptions()` to the root program. Run after TC-123, in the same `initfx` project.
```bash
source /tmp/kinet-tsr/env.sh; cd "$TSR/initfx"
g0=$(grep -m1 'Generated:' CLAUDE.md); sleep 1.1
node "$K" update > /tmp/kinet-tsr/upd.out 2>&1; echo "update-exit=$?"; g1=$(grep -m1 'Generated:' CLAUDE.md); [ "$g0" != "$g1" ] && echo REGENERATED
node "$K" update --rules >/dev/null 2>&1; echo "update-rules-exit=$?"
node "$K" update --context >/dev/null 2>&1; echo "update-context-exit=$?"
node "$K" update --memory >/dev/null 2>&1; echo "update-memory-exit=$?"
node "$K" refresh > /tmp/kinet-tsr/ref.out 2>&1; echo "refresh-exit=$?"; grep -c 'Symlinks refreshed' /tmp/kinet-tsr/ref.out
node "$K" --version
```
Expected: `update-exit=0`, `REGENERATED` (the `> Generated: <ISO>` line in CLAUDE.md has a new timestamp), `update-rules-exit=0`, `update-context-exit=0`, `update-memory-exit=0`, `refresh-exit=0`, `1`, `1.0.1`. `refresh` only works inside the project (it removes stale symlinks under `.kinet/rules` and `.claude/commands`) and needs no network. Dry run at `d5a94e3`: exactly this.

---

## 11. Manual cases (M). A human at a real terminal

### TC-M1 Ctrl-C during `start`. Design: review-2 finding 2, AC-7.5
Why manual: a real Ctrl-C goes to the terminal's foreground process group. The daemon is in its own group, so only a real TTY shows whether it is left orphaned. `start` takes about 0.15 s, so you may need several tries to land inside the window.
Steps (Terminal.app, bash):
1. `source /tmp/kinet-tsr/env.sh; cd "$FX"`
2. Type `node "$K" mcp start --port $P_CC`, press Enter, and press Ctrl-C at once. Repeat up to 5 times. Run `node "$K" mcp stop` between tries that printed `started`.
3. After a try where Ctrl-C landed (no `started` banner): `echo $?; node "$K" mcp status; ls -a .kinet/run; pgrep -fl "kinet.js mcp --port $P_CC"`

Expected: exit `130`, `stopped`, no `mcp.lock` and no `mcp.json`, `pgrep` prints nothing, and `port_free $P_CC` holds. If every try printed `started`, record "window not hit" and rely on TC-M1a.

**TC-M1a scripted proxy (S):**
```bash
source /tmp/kinet-tsr/env.sh; cd "$FX"
for d in 0.03 0.05 0.08 0.1 0.12; do node "$K" mcp start --port $P_CC >/dev/null & S=$!; sleep $d; kill -INT $S; wait $S; e=$?
  printf 'delay=%s exit=%s status=%s lock=%s orphan=%s\n' $d $e "$(node "$K" mcp status | head -1)" "$(test -e .kinet/run/mcp.lock && echo yes || echo no)" "$(pgrep -f "kinet.js mcp --port $P_CC" >/dev/null && echo yes || echo no)"
  node "$K" mcp stop >/dev/null; done
```
Expected: every line shows `status=stopped lock=no orphan=no`, and exit is `130` (or `0` if start finished before the signal). Dry run: all `exit=130 stopped`, no lock, no orphan.

### TC-M2 The server outlives its terminal. AC-7.1
Steps: open a new Terminal window, `source /tmp/kinet-tsr/env.sh; cd "$FX"; node "$K" mcp start --port $P1`, then close the window (confirm "Terminate"). From another window: `cd /tmp/kinet-tsr/fx && node /Users/sjain/dev/personal/kinet/bin/kinet.js mcp status`, then `… mcp stop`.
Expected: `running` with the same pid, then `stopped (pid …)`. TC-73 already shows PPID 1, its own PGID and no TTY.

### TC-M3 `logs -f` with an interactive Ctrl-C. AC-10.2
Steps: `cd "$FX"; node "$K" mcp start --port $P1; node "$K" mcp logs -f`. In a second window, call a tool over SSE (TC-77 steps), or `node "$K" mcp stop` and watch the shutdown line arrive. Press Ctrl-C in the first window, then `echo $?`.
Expected: new lines appear within about 0.5 s. Ctrl-C returns to the prompt with `0`, and no stack trace is printed.

### TC-M4 A real MCP client (Claude Code). AC-6.1, US-6
Steps: in a project already configured by `kinet init` (`args: ["mcp"]`, e.g. `$TSR/initfx` opened in Claude Code with `kinet` on PATH linked to this branch via `npm link`, or editing `command` to `node` with the absolute bin path), run `/mcp`.
Expected: `kinet` shows as connected with 14 tools, and asking it to "run kinet_git_status" returns this repo's branch. Optional second check: configure an SSE server at `http://127.0.0.1:7345/sse` after `kinet mcp start` and confirm it connects. Needs a human judgement call, so it is flagged rather than skipped.

### TC-M5 README reads true. AC-0.7, AC-11.3
Steps: read the README "MCP Tools" and CLI sections.
Expected: 14 tools are listed. `kinet mcp start|stop|status|logs` are documented with default port 7345. The `--port` change to 127.0.0.1-only binding is called out. The known limits (lowercase `todo` difference, SIGKILL orphan, Windows) are stated. Presence is automated (TC-1 `readme.test.js`). Whether it reads truthfully is a human check.

---

## 12. Traceability: AC → TC

A = covered by the repo suite inside TC-1 (test name in brackets). S = scripted here. M = manual.

| AC | Cases |
|----|-------|
| 0.1 | TC-12, TC-14, TC-120 (S); A [tools/list keeps the 9 core tools first…] |
| 0.2 | TC-20, TC-36 (S); A [lists staged… without a .kinet dir] |
| 0.3 | TC-25, TC-49 (S); A [returns a plain message outside a git repo; plain messages without a usable package.json] |
| 0.4 | TC-33, TC-42 (S); A [capText…; safeExec caps long output] |
| 0.5 | TC-58, TC-59, TC-63 (S); A [safeExec passes arguments literally; unknown and injected refs…] |
| 0.6 | TC-5 (S); A [no new production dependency] |
| 0.7 | TC-M5 (M); A [README MCP Tools table lists every tool] |
| 0.8a | TC-55, TC-56 (S); A [refuses bad arguments; assertNoLeadingDash] |
| 0.8b | TC-29 (S, behaviour); A [paths come after the -- separator; the scan path comes after the --] |
| 0.8c | TC-57, TC-62 (S); A [resolveInsideProject keeps paths inside; path is confined to the project] |
| 0.9 | TC-6, TC-44 (S); A [new code uses no synchronous blocking calls] |
| 1.1 | TC-20, TC-23 (S); A [lists staged…; reports upstream ahead/behind] |
| 1.2 | TC-20, TC-21 (S); A [clamps the commit count to 1..50] |
| 1.3 | TC-24, TC-25 (S); A [reports a detached HEAD and an empty repo] |
| 1.4 | TC-22 (S); A [is read-only (AC-1.4)] |
| 2.1 | TC-26, TC-27, TC-28, TC-32 (S); A [working/staged/ref scope] |
| 2.2 | TC-26 (S); A [working scope shows the stat and the patch] |
| 2.3 | TC-29 (S); A [path limits the diff to one file] |
| 2.4 | TC-30 (S); A [unknown and injected refs name the ref] |
| 2.5 | TC-29, TC-31 (S); A [a clean tree says "No changes"] |
| 3.1 | TC-34 (S); A [git repo: finds real markers only…] |
| 3.2 | TC-34 (S); A [shared pattern is character-for-character…; validator and hasTicketRef agree; validator flags the same lines…] |
| 3.3 | TC-34, TC-36 (S); A [skips node_modules, ignored and binary files; non-git directory…] |
| 3.4 | TC-35 (S); A [missingTicketOnly filters results but keeps the counts] |
| 4.1 | TC-38 (S); A [no script lists the scripts and runs nothing] |
| 4.2 | TC-39, TC-59 (S); A [only declared scripts can run] |
| 4.3 | TC-39, TC-42 (S); A [a passing and a failing script…; long output keeps the tail] |
| 4.4 | TC-41 (S); A [a timeout kills the whole process group] |
| 4.5 | TC-40 (S); A [a passing and a failing script are both normal results] |
| 4.6 | TC-14 (S); A [the description warns that it executes project code] |
| 5.1 | TC-48 (S, network); A [parseOutdated reports name, versions and dependency type] |
| 5.2 | TC-48 (S, network); A [parseAudit summarises severities…] |
| 5.3 | TC-45, TC-46 (S); A [is read-only and returns only the requested section] |
| 5.4 | TC-45, TC-47, TC-48 (S); A [is read-only…] |
| 5.5 | TC-45, TC-47 (S); A [an unreachable registry and a missing lockfile are reported per section] |
| 6.1 | TC-12 (S), TC-M4 (M); A [bare `kinet mcp` serves MCP over stdio…] |
| 6.2 | TC-76, TC-113 (S); A [`kinet mcp --port` serves two SSE clients…; binds to 127.0.0.1 only] |
| 6.3 | TC-12, TC-13 (S); A [bare `kinet mcp`… only protocol on stdout] |
| 6.4 | TC-123 (S); A [`kinet init` still configures clients with args ['mcp']] |
| 6.5 | TC-11 (S); A [`kinet mcp --help` lists the subcommands] |
| 6.6 | TC-90, TC-87 (S); A [an unknown subcommand exits non-zero…] |
| 7.1 | TC-72, TC-73 (S), TC-M2 (M); A [start runs a background server…] |
| 7.2 | TC-72, TC-86 (S); A [start runs…; the parent --port is forwarded to start] |
| 7.3 | TC-73, TC-77, TC-98, TC-102, TC-105 (S); A [start runs…] |
| 7.4 | TC-74, TC-98 (S); A [… a second start reuses it] |
| 7.5 | TC-93, TC-94, TC-99, TC-M1/M1a; A [a busy port fails cleanly and leaves no run state; abortStart…; lock tests] |
| 7.6 | TC-76 (S); A [binds to 127.0.0.1 only] |
| 8.1 | TC-75 (S); A [start runs…, status reports it] |
| 8.2 | TC-70, TC-82 (S); A [status with no state says stopped and creates nothing] |
| 8.3 | TC-96, TC-97, TC-98, TC-101, TC-104, TC-106 (S); A [status clears state that points at an unrelated live process; a corrupt state file reads as stopped; checkIdentity…] |
| 8.4 | TC-70, TC-80 (S); A [status with no state… creates nothing; checkIdentity… nothing is deleted] |
| 9.1 | TC-82, TC-101 (S); A [stop shuts the server down gracefully…; stop force-kills a server that ignores /shutdown] |
| 9.2 | TC-83, TC-96 (S); A [stop never signals an unrelated process…] |
| 9.3 | TC-96, TC-98, TC-106 (S); A [stop never signals an unrelated process that reuses the pid] |
| 10.1 | TC-78 (S); A [logs record start, tool calls and shutdown…] |
| 10.2 | TC-79 (S), TC-M3 (M); A [logs -f streams new lines until Ctrl-C] |
| 10.3 | TC-77, TC-81, TC-84, TC-104 (S); A [logs record start, tool calls and shutdown without argument values; every tool call is logged by name and outcome] |
| 10.4 | TC-71 (S); A [logs without a log file explains what to do] |
| 10.5 | TC-84, TC-85 (S); A [… start rotates them; after the cap, info and tool lines are dropped] |
| 11.1 | TC-1, TC-7 (S) |
| 11.2 | TC-2, TC-3 (S) |
| 11.3 | TC-M5 (M); A [README documents the lifecycle commands and localhost binding] |
| 01 §8 / D8 (Host/Origin), 06-security finding 4 | TC-110, TC-111, TC-115 (S); A [guard refuses foreign Host and Origin headers] |
| Design extras (not ACs) | TC-4, TC-43, TC-60, TC-61, TC-64, TC-87 (F-6), TC-91, TC-92, TC-95, TC-100, TC-103, TC-112, TC-114, TC-120-125 |

Every AC from 0.1 to 11.3 has at least one scripted or manual case and, except 11.1/11.2 (gates by nature), at least one automated test.

---

## 13. Dry-run results (2026-10-25, Node 24.15.0, macOS)

**Revision 2, at `d5a94e3`.** Re-run exactly as written: TC-S1, TC-S3, TC-1 (117/117), TC-2, TC-3 (0 violations, 33 warnings), TC-35, 36, 45, 64, 73, 87, 90, 94, 98, 101, 102, 106 (both variants), 123, 125 (all steps).
**Revision 1, at `f4144d8`.** These were run and are unaffected by the fixes: TC-4-14, 20-34, 37-44, 46, 47, 49, 55-63, 70-72, 74-86, 91-93, 95-97, 99, 100, 103-105, 110-115, 120, 122, M1a.
Not dry-run: TC-48, 121 (network), TC-124 (trivial), TC-M1-M5 (manual).
All servers, worktrees and fixtures were cleaned up after each round. The repo working tree has no changes apart from this file.

Findings from revision 1, and their status at `d5a94e3`:

**F-1. Medium. Fixed. A hung daemon was orphaned by `status`/`stop` (TC-101).** AC-9.1, AC-8.3.
- Before: `status` gave `stopped (stale)` and deleted `mcp.json` while the frozen process kept the port.
- Fix: `status` now reports `unresponsive` (exit 2) and keeps the state. `start` refuses with exit 1. `stop` force-kills the server after 5 s.
- Design: 03-design §5.2/§5.3/§5.4/§5.6. TC-106 shows the fix still never signals an unrelated process (review-6a #2).

**F-2. Low. Fixed. `start` succeeded when the port was held on the wildcard address (TC-94).** AC-7.5.
- Before: macOS let kinet bind `127.0.0.1:P` next to the holder's `*:P`.
- Now: `Error: port P is in use. Try: kinet mcp start --port <other>`, exit 1.

**F-3. Low. Accepted deviation. `kinet validate` has 33 warnings vs design budget 30 (TC-3).**
- The extra warnings are false positives: the validator's case-insensitive `TODO` regex matches the name `find-todos`/`kinet_find_todos` in `src/mcp/tools/local.js`, `find-todos.js`, `find-todos.test.js` and `git-hostile-config.test.js`.
- TC-3 now expects exactly 33, and fails above that.

**F-4. Medium. Fixed. `kinet validate` reported 2 `no-hardcoded-secrets` violations (TC-3).** AC-11.2.
- Cause: `src/mcp/runstate.test.js` (`token: 'secret-token'`, from `1bfc922`).
- Now: `violations=0`.

**F-5. Medium. Fixed. A copied project's state file let `stop` kill the original project's server (TC-98).** AC-9.3, AC-7.3.
- Real-world trigger: `cp -R` of a project while its server runs.
- Fix: identity now requires the state and `/health` `cwd` to equal this directory's realpath (03-design §5.3). TC-98 checks `status`, `stop`, and that `start` launches the copy's own server.

**F-6. Low. Fixed. Subcommands silently ignored stray arguments (TC-87).**
- Before: `kinet mcp start 9000` started on 7345.
- Now: `error: too many arguments for '<sub>'. Expected 0 arguments but got 1.`, exit 1, for all four subcommands (03-design §5.1).

Not defects (accepted deviations, recorded so nobody re-raises them):
1. The URL prints `http://127.0.0.1:<port>/sse` rather than the AC's `localhost` (design §5.2).
2. `npm test` is the bare `node --test`, not a quoted glob (design §0.3).
3. During concurrent starts, the loser may exit 1 with the lock message instead of "already running" (design §5.2 step 1).
4. Review-5 finding 2 (`logs -f` can skip the head of a rotated log within one 250 ms poll) is cosmetic and is not tested here.
5. F-3 (warning count 33), above.

## 14. Cleanup (run at the end, whatever the outcome)

```bash
source /tmp/kinet-tsr/env.sh
for d in "$FX" "$OTHER" "$FXU"; do (cd "$d" 2>/dev/null && node "$K" mcp stop >/dev/null 2>&1); done
pkill -CONT -f "kinet.js mcp --port" 2>/dev/null; pkill -f "kinet.js mcp --port" 2>/dev/null; pkill -f 'setTimeout\(\(\)=>\{\},(30000|60000)\)' 2>/dev/null
git -C "$R" worktree prune; git -C "$R" worktree list; git -C "$R" status --porcelain
rm -rf /tmp/kinet-tsr
pgrep -fl "kinet.js mcp"; echo "clean=$?"
```
Expected: one worktree. The repo's porcelain shows only the delivery docs. `clean=1`.
