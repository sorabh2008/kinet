# BUG-2: Ctrl-C in a real terminal during `kinet mcp start` can crash the signal handler with `kill EPERM`

**Status: FIXED in `c2068cd`, VERIFIED in TSR round 3.** The group kill now never throws (`killGroupQuietly` swallows ESRCH/EPERM). Cleanup is async, runs once, never rejects, and exits 130 after it settles.
- New regression case TC-B2 (`06-test-plan.md` §10b): 192 real-terminal (pty) Ctrl-Cs at 20-125 ms gave `trials=192 crashes=0 stale-locks=0 not-130=0 orphans=0`.
- TC-M1 (5 human-style Ctrl-C tries in a pty) and M1a: all exit 130, `stopped`, no lock, no orphan, no stack trace.
- TC-B1 (60 × `kill -INT`): `lock-leaks=0 / 60`.

- Found by: TSR round 2, case TC-M1 (Ctrl-C during `start`), real-TTY trials
- Branch: `feature/mcp-cli-and-tools` @ `0710aa7`
- Environment: local, macOS 27.0.1 arm64, Node v24.15.0, interactive bash in a pty (real terminal Ctrl-C)
- Severity: **Low**
  - The user sees a Node stack trace and exit code `1` instead of a clean `130`.
  - A dead-pid `mcp.lock` is left behind. The next `start` treats it as stale and succeeds.
  - No orphan daemon was seen (0 in 192 trials).
- Trace: AC-7.5 ("leaves no stale run state behind"), design §5.2 step 5 (`abortStart` ignores `ESRCH`), TC-M1 expected result. This is the residual path of BUG-1.

## Steps to reproduce

You need a real terminal: the bug does not reproduce with `kill -INT <pid>`, which is why TC-B1 passes.
1. In Terminal.app, run `mkdir -p /tmp/bug2 && cd /tmp/bug2 && git init -q`.
2. Run `node /Users/sjain/dev/personal/kinet/bin/kinet.js mcp start --port 47317 >/dev/null`, and press **Ctrl-C** within about 0-80 ms of Enter. Repeat 20-50 times, running `kinet mcp stop` between tries that started.
3. After each try: `echo $?; ls -a .kinet/run`.

The scripted equivalent used in the TSR drives an interactive `bash -i` in a pty and writes `\x03` to the terminal 0-80 ms after the command. That reproduced it 4 times in 192 trials across 4 batches.

## Expected

Every interrupted start exits `130`, prints no stack trace, and leaves no `mcp.lock`, `mcp.lock.<pid>.tmp` or `mcp.json`. No `kinet.js mcp --port` process is left.

## Actual

In about 2% of real-terminal Ctrl-Cs (4 of 192), `start` dies from an uncaught exception thrown inside its own SIGINT handler:
```
file:///Users/sjain/dev/personal/kinet/src/cli/mcp.js:63
    if (err.code !== 'ESRCH') throw err;
                              ^

Error: kill EPERM
```
- The exit code is `1`, not `130`.
- `.kinet/run/mcp.lock` is left with the dead start pid, e.g. `{"pid":68967,"createdAt":"2026-10-25T10:58:15.290Z"}`.
- An immediate retry works (`KINET MCP server started`), because a dead-pid lock is stale.
- In the dedicated batch: `trials=36 eperm-crash=1 lock-left=1 orphan=0`.

## Likely cause

`abortStart()` calls `killGroup(child.pid, 'SIGKILL')`, which runs `process.kill(-child.pid, …)` and rethrows anything except `ESRCH`.
- A terminal Ctrl-C is sent to the whole foreground process group. Right after `spawn()`, the detached child may not yet have called `setsid()`, so it is still in that group. The child then gets the SIGINT too, or is mid-transition.
- `kill(-child.pid)` against a group that does not exist yet, or that holds only a just-exited process, returns `EPERM` on macOS.
- The throw aborts the handler before `releaseLockSync()` and `process.exit(130)`. Node then reports the uncaught exception (exit 1), and the lock stays.

## Fix idea

In `abortStart`/`killGroup`, ignore `EPERM` as well as `ESRCH` (or catch everything) for the group kill, and fall back to `process.kill(child.pid, 'SIGKILL')`. Always run `releaseLockSync()` and `process.exit(130)` in a `finally`. A regression test needs a real pty: `node:test` can drive `script(1)` or `python3 -c 'import pty…'`.

## Evidence

- Batch 1 (TC-M1 sweep, 36 trials): `lock-leaks=1`, `exits={'EXIT=1': 4, 'EXIT=130': 32}`.
- Batch 2 (48 trials at 10-35 ms): 0 leaks.
- Batch 3 (72 trials): 2 leaks, both with stderr `Error: kill EPERM` at `src/cli/mcp.js:63`, both exit 1, and both locks held a dead pid.
- Batch 4 (36 trials): `eperm-crash=1 lock-left=1 orphan=0`.
- TC-B1 (60 trials via `kill -INT`, same delays): `lock-leaks=0 / 60`. The non-TTY path is fixed.
