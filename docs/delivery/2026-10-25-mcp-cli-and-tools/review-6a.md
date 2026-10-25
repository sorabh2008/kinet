CHANGES_REQUESTED

# Review 6a: Tester stage (06-test-plan.md, working tree on top of f4144d8)

Reviewer gate for the test plan, checked against 01-requirement.md and 03-design.md. Most of the plan is strong. Every AC from 0.1 to 11.3 appears in the §12 table. All the required negatives exist (option injection TC-55/56, path escape TC-57/62, unknown script TC-59, unknown subcommand TC-90, port busy TC-93/94/95, stale pid and lock TC-96/97/99, Host header TC-110, symlinked run dir TC-105, copied state TC-98). All 9 core tools are covered (TC-120/121/122). A/S/M are marked, and §0 states the environment limits. The plan is not ready to freeze yet: the cases for the bugs now being fixed do not give an exact expected result for the fixed behaviour, and one of those fixes opens a new hole that no case checks.

## Blocking

1. **TC-101 (F-1) has no exact expected result for the fixed behaviour.** The current text only says "stop ends the process, and status does not throw away the only handle". Replace it with exact lines:
   - `status`: first line `unresponsive` (the exact wording the Developer ships, with pid/port), the exact non-zero exit code, and `STATE-KEPT`.
   - `stop`: `stopped (pid <PID>, force-killed after 5 s)`, `stop-exit=0`, `real` between 5 and 7 s, `GONE`, `PORT-FREE`, and `mcp.json` removed.
   - A following `status`: `stopped`, exit 1.
   This also contradicts 03-design: §5.3 says "the first line is always exactly `running`, `stopped` or `stopped (stale)`", §2.7 gives `checkIdentity` only three states, and the §5.6 exit table has no `unresponsive` row. Either get 03-design §2.7/§5.3/§5.4/§5.6 amended with the fix, or have the plan cite the fix decision as an accepted design change. Otherwise the case contradicts the design it says it tests.

2. **No case checks that the F-1 fix still respects AC-9.3.** Once "pid alive + /health timeout" means `unresponsive` and `stop` force-kills, an unrelated process can be SIGKILLed in this situation: it reuses the pid, it holds the port, and it accepts connections but never answers HTTP. TC-96 does not cover this. Its decoy listens on nothing, so the probe gets ECONNREFUSED and the result is `stale`. Add a case: start `node -e 'require("net").createServer(()=>{}).listen(+process.argv[1],"127.0.0.1")' $P_LOCK &`, write its pid and port into `mcp.json` (same shape as TC-96), then run `status` and `stop`. Expected: the decoy is still alive afterwards (`kill -0` succeeds), and the case states exactly what `status`/`stop` print. Whatever the fix uses to confirm identity for a hung server (for example, the pid's command line is `…/bin/kinet.js mcp --port <port>` and its cwd is this project), the case must show that an unrelated process is never signalled. Trace it to AC-9.3 and AC-8.3 in §12.

3. **TC-90 (F-6) expected result is vague, and the case covers only `start`.** "A non-zero exit with an excess-argument error" is not measurable. State commander's exact text, e.g. `error: too many arguments for 'start'. Expected 0 arguments but got 1.`, with `exit=1`, no daemon (`pgrep` prints nothing) and no `mcp.json`. F-6 says `stop`, `status` and `logs` are affected too, so loop over all four (`start 9000`, `stop x`, `status x`, `logs x`). Keep `kinet mcp foo bar` giving the unknown-subcommand message. The "run `mcp stop` after this step" note should become cleanup that expects `not running`. Also note that 03-design §5.1 puts `.allowExcessArguments()` on `mcp`, and subcommands inherit it. The design should record that subcommands now override it, or the fixed behaviour contradicts the documented wiring.

4. **TC-98 (copied project, F-5) does not check the fixed `start` behaviour.** F-5's own "Expected" says "start launches projB's own server", but TC-98 only checks `status` and `stop`. After copying OTHER's state into FX, run `node "$K" mcp start --port $P1`. Expected: `KINET MCP server started`, a pid different from `$OPID` (not `already running`), and OTHER still `running`. Then stop FX. Without this step, AC-7.4/7.3 behaviour in a copied project goes untested.

5. **The regression section does not run `kinet update` or `kinet refresh`, although the branch changes the code behind them.** `git diff develop...HEAD` touches `src/cli/update.js`, `src/cli/init.js`, `src/context/distiller.js`, `src/rules/engine.js`, `src/prp/system.js`, `src/rules/validators/common.js`, and adds `enablePositionalOptions()` on the root program in `bin/kinet.js`. TC-123 only runs `update --help`. In `$TSR/initfx`, add `node "$K" update; echo "update-exit=$?"` (expect 0, with CLAUDE.md regenerated and a new `Generated:` timestamp), `node "$K" update --rules` (exit 0), `node "$K" refresh; echo "refresh-exit=$?"` (exit 0, or BLOCKED (network) if it needs the network), and `node "$K" --version` (prints `1.0.1`).

## Non-blocking

6. **TC-94 (F-2) expected result is not exact.** State stderr `Error: port 47314 is in use. Try: kinet mcp start --port <other>`, `exit=1`, a single LISTEN row `*:47314` (the holder only), no `mcp.json`/`mcp.lock`, and no orphan. The cleanup `stop` should then expect `not running`.
7. **The test count disagrees with itself.** §1 says "100 tests" and TC-1 says 109. The fixes will add tests, so write "N ≥ 109" and refresh the frozen head in TC-S2 and the header at freeze.
8. **TC-3 and TC-124 will fail until F-4 is fixed and F-3 is decided.** TC-3's `warnings ≤ 30` fails at 33 on every run unless the budget is amended or the false positives are fixed. Record the decision before freeze. TC-124's plain `validate` exits 1 while violations exist, so cross-reference F-4 there.
9. **Some steps are not literally copy-paste.** TC-35 and TC-36 say "same as TC-34 with…" and should give the commands. TC-45 mentions `shasum` before and after but has no command. TC-73 has a `stat` step outside the code block. TC-72 has an unused `s=$(date +%s.%N …)` (on macOS `%N` prints a literal `N`).
10. **TC-64 can be flaky.** `ok` may finish before the second request is handled, and then both run normally. Use `slow` with `timeoutSeconds:2` as the first call, so the second call reliably gets `A script is already running`.
11. **Some cross-references are wrong.** TC-94 and TC-101 say "See §12" for F-2 and F-1, but the findings are in §13. §13 lists F-4 before F-3.

## Checked and fine
- The expected results of TC-110 (`127.0.0.1` without a port → 403), TC-112 (GET `/shutdown` → 404), TC-91, TC-92, TC-95 (exit 3), TC-97 (corrupt state → `stopped`), TC-99, TC-M1/M1a (exit 130), TC-72 (`127.0.0.1` URL, accepted deviation) and TC-7 (bare `node --test`, accepted deviation) all match 03-design §5-§7.
- TC-115 (406 and Sec-Fetch-Site) is not in 03-design, but it correctly traces to 06-security finding 4.
