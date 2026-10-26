APPROVED

# Review 6a: Tester stage (06-test-plan.md)

## Round 2 (working-tree plan on top of d5a94e3)

The design amendments landed in `cc42929` and `274514b`, not `d5a94e3`. `d5a94e3` only changes a test file. All three commits are on the branch, so this changes nothing for the review.

### Round 1 findings
1. **TC-101 (F-1): resolved.** The expected output is exact and matches 03-design word for word: block U (all 5 lines, including `hint:`), `status-exit=2`, `STATE-KEPT`, and the `start` refusal `Error: the MCP server for this project (pid <PID>) is not responding. Run: kinet mcp stop` with exit 1. Then `stopped (pid <PID>, force-killed after 5 s)` with exit 0, `real` between 5 and 8 s, `GONE`, `PORT-FREE`, `STATE-CLEARED`, and a final `stopped` with exit 1. These match §5.2 step 2, §5.3 block U, §5.4 and §5.6.
2. **The AC-9.3 hole opened by the F-1 fix: resolved.** TC-106 adds a decoy that accepts TCP connections but never answers HTTP. It has two variants: an old `startedAt`, and a fresh `startedAt` where only the command-line check can reject it. Both expect `stopped (stale)` and `not running (cleared stale state)`, and the decoy is still alive after both stops. This matches §5.3 "Confirming a hung pid is ours" and §5.4 step 2. It traces to 8.3 and 9.3.
3. **TC-90 / TC-87 (F-6): resolved.** TC-87 covers all four subcommands, one per line, with commander's exact message and `exit=1`, then `no-daemon=1`, `NO-STATE`, and a cleanup `not running`. This matches §5.1 and §5.6. TC-90 still covers `foo` and `foo bar`.
4. **TC-98 (F-5): resolved.** It now checks that `start` in the copy prints `KINET MCP server started` with a pid that differs from OTHER's (`DIFFERENT-PID`), and that OTHER stays `running`. This matches the §5.3 realpath identity rule. It traces to 7.3 and 7.4.
5. **Regression gap: resolved.** TC-125 runs `update`, `update --rules`, `update --context`, `update --memory` and `refresh`, checks that CLAUDE.md is regenerated (`Generated:` changes), and checks that `--version` prints `1.0.1`.
6. **TC-94 (F-2): resolved.** Exact stderr, `exit=1`, a single `*:47314` listener, no state, no orphan, and a cleanup `not running`. This matches §2.6 step 7 (connect probe, exit 3) and the §5.2 step 8 message.
7. **Test count: resolved.** `N ≥ 117`, and the header and TC-S2 say to refresh the head at freeze.
8. **TC-3 / TC-124: resolved.** F-4 is fixed (`violations=0`). F-3 is recorded as an accepted deviation with an exact count of 33 that fails above 33. TC-124 cross-references TC-3.
9. **Copy-paste gaps: resolved.** TC-35, TC-36 and TC-45 now have literal commands and exact output. The `stat` step in TC-73 is inside the block, and the unused variable in TC-72 is gone.
10. **TC-64 flakiness: resolved.** `slow` with `timeoutSeconds:2` now holds the slot, so the result no longer depends on timing.
11. **Cross-references: resolved.** The §12 and §13 references are correct, and the F-list is in order.

### Remaining nits (non-blocking)
1. 03-design §0.5 and §9 row 11.2 still say "warnings ≤ baseline + 1" (30). TC-3 expects 33 under the F-3 deviation, which is recorded only in 04-plan and in §13 of this plan. Either amend 03 row 11.2 or have Saurabh confirm the deviation at close-out, so the design does not contradict the gate.
2. 03-design §5.1 shows the unknown-subcommand call as `command.error(\`unknown subcommand …\`)`, with no prefix. The code (`bin/kinet.js:75`) and TC-90 use `error: unknown subcommand …`. The plan matches the code. Update the design snippet when you next touch it.
