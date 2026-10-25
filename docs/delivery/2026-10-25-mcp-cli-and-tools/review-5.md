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
