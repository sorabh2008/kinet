# BUG-4: TC-64 is non-deterministic, because the script slot goes to whichever call reads `package.json` first

**Status: TEST-CASE DEFECT, CORRECTED in round 3. No product change.** TC-64 in `06-test-plan.md` now starts `slow`, waits until its process is confirmed running (`pgrep`, recorded as `slow-confirmed-running`), and only then sends the second call. The assertion is unchanged in strength: exactly one script runs (`slow`, timed out after 4 s), and the other gets the documented busy result `A script is already running (slow); wait for it to finish.` with no `exit code:` line. Verified at `c2068cd`: 20/20 identical results, plus the TC-64 run in the round-3 table.

- Found by: TSR round 2, case TC-64 (single-flight script runs, design §4.4)
- Branch: `feature/mcp-cli-and-tools` @ `0710aa7` (the same behaviour exists at `4f813f4`; round 1 happened to pass)
- Severity: **Low. Mainly a test-plan defect** (the Tester's own case). The product meets design §4.4: in every run exactly one script ran and the other was refused with `A script is already running (<name>)`. The frozen expected result (`slow` always wins) does not hold, so the case is recorded as FAIL rather than silently re-scoped.
- Trace: design §4.4 step 5, 06-test-plan TC-64 ("`slow` holds the slot for 2 s, so the result does not depend on timing"; that claim is wrong).

## Steps to reproduce

```bash
source /tmp/kinet-tsr/env.sh; cd "$FX"   # fixtures from TC-S1/TC-S3
for i in $(seq 1 20); do MCP_WAIT=3 MCP_MAX=60 mcp_rpc "$(call 2 kinet_run_script '{"script":"slow","timeoutSeconds":2}')" "$(call 3 kinet_run_script '{"script":"ok"}')" | tr '\n' ' '; echo; done
```

## Expected (frozen TC-64)

`id=2` runs `slow` (timed out after 2 s), and `id=3` gets `A script is already running (slow); wait for it to finish.`

## Actual

`slow-won=14 ok-won=6 other=0` over 20 runs. In the round-2 run of TC-64 itself:
```
id=2 isError=false "A script is already running (ok); wait for it to finish."
id=3 isError=false "script: ok … exit code: 0 …"
```

## Cause

Both `tools/call` requests are handled concurrently. `run-script.js` checks and sets the module-level `running` name only after `await readFile('package.json')`. Whichever read finishes first takes the slot, not whichever request arrived first.

## Fix options

1. Amend TC-64 through a reviewed plan change to assert the invariant: exactly one of the two ran, and the other got `A script is already running (<the other's name>)`.
2. Or make the product arrival-ordered by claiming the slot synchronously before the first `await`, if strict FIFO is wanted.

## Evidence

TSR round 2, TC-64 output plus the 20-run measurement above.
