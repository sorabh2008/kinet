APPROVED

# Review 4 — Manager stage (04-plan.md)

## Round 2

All four round-1 findings are resolved. Nothing new found.

1. **[was blocking] Directory arguments to `node --test`: fixed.**
   - S3, S10, S11 and S12 now list explicit test files. S8 uses `npm test`.
   - I ran S10's command on Node 24.15: `node --test src/cli/mcp.test.js src/cli/mcp-routing.test.js src/cli/mcp-lifecycle.test.js src/mcp/runstate.test.js`.
   - Node treated every argument as a file. It reported `Could not find '<the four files>'`, which is expected because the code does not exist yet. It did not fail with the directory-as-module error from round 1, so the command form is valid.
2. **S11 manual check: fixed.** It now runs `mcp start && mcp stop && mcp status; echo $?`, which uses the live-server path, and expects `stopped (pid N)`, then `stopped` and 1.
3. **AC-0.3 and AC-0.8c coverage: fixed.**
   - AC-0.3 is now listed under S5, S7 and S8.
   - AC-0.8c is listed under S6 (via `resolveInsideProject`).
4. **03 cleanup: fixed.**
   - The cleanup now belongs to S0, and Open item 3 points there.
   - S0's verify step greps 03 for `TBC-1` and the old glob, expecting no matches. That grep matches 6 lines today, so it will catch a cleanup that gets missed.

## Round 1 (for the record)

- Every AC maps to a slice.
- The slice order keeps the repo green and runnable.
- Review-3 findings 1-3 are folded in. Finding 4 is routed to Security 6b and the README.
- Deferrals match 01 §6.
- The S3 stdio pipe command (9 tools today) and `kinet validate` both ran correctly.
