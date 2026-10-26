# BUG-1: Ctrl-C very early in `kinet mcp start` can leave `mcp.lock` behind

**Status: FIXED in `0710aa7`. Verified for the reported path; one residual path remains, filed as BUG-2 (TSR round 2).**
- Verified: TC-B1 (the repro loop below, 60 SIGINTs via `kill -INT`) gave `interrupted(130)=60 lock-leaks=0 / 60`, no orphan. Locks are now written atomically (temp file + `link`), an empty or unparsable lock counts as stale, and the signal handler is installed before the lock is taken.
- Not fully fixed under a real terminal: across 192 real-TTY Ctrl-Cs (pty), 4 still left `mcp.lock`. Every one coincided with the new handler crashing on `Error: kill EPERM`. That is a different root cause, tracked in `BUG-2.md`.

- Found by: TSR round 1, case TC-M1 (Ctrl-C during `start`)
- Branch: `feature/mcp-cli-and-tools` @ `4f813f4`
- Environment: local, macOS 27.0.1 arm64, Node v24.15.0
- Severity: **Low.** A dead-pid lock heals itself at the next `start`. An empty lock blocks every `start` for up to 10 s with a misleading message. No orphan daemon was seen in 60+ trials, but see "Risk" below.
- Trace: AC-7.5 ("leaves no stale run state behind"), design §5.2 step 5 / review-2 finding 2, and TC-M1's expected "no `mcp.lock`".

## Steps to reproduce

```bash
mkdir -p /tmp/bug1 && cd /tmp/bug1 && git init -q
K=/Users/sjain/dev/personal/kinet/bin/kinet.js
leaks=0
for r in 1 2 3 4 5; do for d in 0.02 0.03 0.04 0.05 0.06 0.07 0.08 0.09 0.10 0.11 0.12 0.13; do
  node "$K" mcp start --port 47317 >/dev/null 2>&1 & S=$!; sleep $d; kill -INT $S; wait $S
  if [ -e .kinet/run/mcp.lock ]; then leaks=$((leaks+1)); echo "LOCK d=$d $(cat .kinet/run/mcp.lock)"; rm -f .kinet/run/mcp.lock; fi
  node "$K" mcp stop >/dev/null; rm -f .kinet/run/mcp.json
done; done; echo "lock-leaks=$leaks / 60"
```

Then, to see the user-visible effect of an empty leftover lock:

```bash
: > .kinet/run/mcp.lock; node "$K" mcp start --port 47317; echo "exit=$?"
```

In a real terminal, the same thing happens when you press Ctrl-C right after Enter on `kinet mcp start`. In the pty-driven run, Ctrl-C at 30 ms and 60 ms left a lock behind.

## Expected

After Ctrl-C during `start`:
- exit `130`
- `status` says `stopped`
- **no `mcp.lock`** and no `mcp.json`
- no orphan `kinet.js mcp --port` process

A retry straight away starts normally.

## Actual

- 4 of 60 SIGINTs, all at about 20 ms into `start`, exited `130` and left `.kinet/run/mcp.lock`. Two of the leftover locks were **empty**. Two held the pid of the dead `start` process (`{"pid":44564,"createdAt":"2026-10-25T09:49:43.679Z"}`).
- In the real-TTY run (pty, interactive bash), Ctrl-C at 30 ms and 60 ms left `mcp.lock` behind (`ls -a .kinet/run | grep -c mcp.lock` printed `1`).
- With an empty lock, an immediate retry fails, and keeps failing until the lock's mtime is more than 10 s old:
  ```
  Error: another 'kinet mcp start' is running for this project (pid unknown).
  exit=1
  ```
  After 10 s, `start` works (`KINET MCP server started`).
- A dead-pid lock does not block. The next `start` treats it as stale and succeeds.

## Likely cause

`runMcpStart` (`src/cli/mcp.js`) registers its SIGINT/SIGTERM handler only after `acquireLock()`, `checkIdentity()`, `rotateLog()` and `spawnDaemon()`. A SIGINT inside that window gets Node's default action: the process dies with 130 and the `finally { release() }` never runs. Two different lock files can result:
- If the signal lands between `open(lock, 'wx')` and the write inside `createLock`, the file is **empty**. `acquireLock` then judges it by mtime, which is the 10 s block.
- If it lands after the write, the file holds the dead pid.

The design accepted the second case ("the next start treats that lock as stale"). The empty-lock case and its 10 s block are not covered.

## Risk (not observed)

`spawnDaemon()` awaits `logFile.close()` after `spawn()` and before the handler is registered. A SIGINT in that gap would kill `start` with the detached daemon already spawned, leaving an orphan server with no `mcp.json`. 0 of 60+ trials hit it.

## Fix idea

- Register the signal handler right after `acquireLock()` succeeds. Have it kill the child only if one has been spawned.
- Or, in `acquireLock`, treat an empty or unparseable lock as stale at once when the pid is unknown.

## Evidence

- Full-check and per-case outputs from round 1 (`/tmp/kinet-run/out/*.out`, removed at cleanup, summarised in `TSR.md`).
- Sweep output: `LOCK d=0.02 exit=130` ×4 (two empty, two with a dead pid), `trials=60 lock-leaks=4 orphans=0`.
- Retry output: `Error: another 'kinet mcp start' is running for this project (pid unknown).`, `retry exit=1`. After `sleep 10.5`: `KINET MCP server started`.
