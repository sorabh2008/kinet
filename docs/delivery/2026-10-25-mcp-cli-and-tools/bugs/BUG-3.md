# BUG-3: The BUG-1 fix adds `readFileSync` to `src/cli/mcp.js`, failing the TC-6 no-sync gate

**Status: FIXED in `c2068cd`, VERIFIED in TSR round 3.** `readFileSync`/`unlinkSync` are gone from `src/cli/mcp.js`: the lock release now uses the in-memory release function, with no read-back from disk. `src/mcp/no-sync.test.js` was also extended (part of the 121-test suite, all passing).
- TC-6 as frozen (unchanged pattern and file list): no output, `matches-exit=1`.
- Extra check: `grep -n 'Sync' src/cli/mcp.js` finds no `*Sync(` call.

- Found by: TSR round 2, case TC-6 (static check, AC-0.9)
- Branch: `feature/mcp-cli-and-tools` @ `0710aa7` (introduced by `0710aa7`)
- Severity: **Low.** There is no runtime impact. The calls run only inside the SIGINT/SIGTERM handler right before `process.exit()`, never in an MCP request path. But the frozen gate fails, so either the code or the design/plan has to change through the normal review route. The plan must not be quietly weakened.
- Trace: AC-0.9 (no `*Sync` calls in new tool code; rule `node/no-synchronous-blocking-calls-in-request-handlers`), 06-test-plan TC-6, which lists `src/cli/mcp.js` and the pattern `readFileSync`.

## Steps to reproduce

```bash
cd /Users/sjain/dev/personal/kinet
grep -nE 'execSync|spawnSync|execFileSync|readFileSync|writeFileSync' src/mcp/tools/{git-status,git-diff,find-todos,run-script,check-deps,git-common,npm-common,local}.js src/utils/{exec,args}.js src/mcp/{http,log,runstate}.js src/cli/mcp.js; echo "matches-exit=$?"
```

## Expected (TC-6)

No output, `matches-exit=1`.

## Actual

```
src/cli/mcp.js:4:import { readFileSync, unlinkSync, unwatchFile, watchFile } from 'node:fs';
src/cli/mcp.js:76:    if (JSON.parse(readFileSync(lockPath, 'utf8')).pid === process.pid) unlinkSync(lockPath);
matches-exit=0
```
`unlinkSync` (lines 4, 72, 76) is also synchronous, though TC-6's pattern doesn't list it. `npm test` still passes because `src/mcp/no-sync.test.js` does not scan `src/cli/mcp.js`. `kinet validate` reports no violation either.

## Notes for the decision

The synchronous calls are deliberate: async work never completes once `process.exit()` runs in a signal handler (comment at `src/cli/mcp.js:67-68`). Two options:
1. Keep them, and amend 03-design §2.8/§9 and TC-6 through a reviewed plan change to exempt the signal-handler path. Also add `src/cli/mcp.js` to `no-sync.test.js` with an explicit allowlist.
2. Avoid them. Record the lock's identity (inode or token) at acquire time so the handler can unlink without reading, then call `process.exit` from the async completion. This is harder to make safe.

## Evidence

TSR round 2, TC-6 output above. Diff: `git diff 4f813f4 0710aa7 -- src/cli/mcp.js`.
