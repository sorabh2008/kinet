APPROVED

# Review 3 — Solution Designer stage (03-design.md)

## What I checked

- **AC coverage:** every AC in 01 (0.1-0.9, 1.x-5.x, 6.1-6.6, 7.1-7.6, 8.1-8.4, 9.1-9.3, 10.1-10.5, 11.1-11.3) has a design element in §2-§8 and a row in the §9 test table. The rows for 11.1 and 11.2 are Tester checks, and the Ctrl-C case is a manual TSR step. Both are acceptable.
- **Review-2 findings 1-5 are all resolved:**
  1. The grep uses `-w -E`. §0.1 also correctly tightens the exclude to `:(exclude,glob)**/node_modules/**`, and §4.3 adds `-z` parsing.
  2. The lock records the owner pid and has stale rules. `abortStart` runs on SIGINT/SIGTERM. Because the child is spawned `detached`, the terminal's Ctrl-C does not reach it, so the explicit group kill is needed.
  3. The HTTP handler has a top-level try/catch with a test.
  4. Child process groups are killed on shutdown and on exit, and the token is stripped in `safeExec` and deleted from `process.env` at boot. The SIGKILL orphan case is documented as an accepted limitation.
  5. The parent `--port` is forwarded to `start` and rejected on stop/status/logs. T1 uses `--no-optional-locks`.
- **Contracts are consistent with each other.** `probeHealth`, `checkIdentity`, `waitForHealthy` (pid match), the `/health` body and the `mcp.json` shape line up. The tool shape `{definition, run(args, ctx)}` matches the registry and dispatch in §2.6. The `safeExec` options match every call site in §4.
- **No new production dependency.** `@eslint/js` 9.39.4 is a devDependency and is already installed as eslint's own dependency.
- **Security mechanics are sound:**
  - 127.0.0.1 bind.
  - Exact Host allowlist, which blocks DNS rebinding.
  - Origin allowlist.
  - Constant-time token comparison with a length pre-check. The token travels by env var, not argv, and the state file is 0600.
  - Leading-dash refusal, `--` separators, unknown refs stopped by `rev-parse --verify`, and `hasOwn` for script names.
  - Realpath containment for paths that exist. For paths that do not exist, git itself refuses paths beyond a symlink.
- **Scope:** nothing material beyond the ACs. The unused-import deletions are needed for AC-11.2. The `files` negations stop the new tests from shipping in the tarball. Both are proportionate.

## Findings

1. **[non-blocking, required — Developer applies, no design re-review needed] Use a bare `"test": "node --test"` instead of the quoted glob, and drop TBC-1.**
   - Verified on this machine (default Node v24.15.0) with a fixture containing `src/a.test.js`, `src/mcp/tools/b.test.js`, `node_modules/dep/c.test.js` and a `src/test-support/helpers.js` that throws if loaded.
   - Bare `node --test` ran exactly the 2 `src` tests (`# tests 2`, exit 0) on Node 20.20.2, 22, 24.15.0 and 26.0.0. It skipped `node_modules` and did not load the helper.
   - The quoted `node --test "src/**/*.test.js"` fails on Node 20.20.2 with `Could not find '.../src/**/*.test.js'`. Option b in TBC-1 therefore leaves `npm test` broken on a Node version that `engines` (>=20, unchanged) says is supported.
   - The bare form also meets AC-11.1's intent: Node, not the shell, resolves the files. Its default patterns match nothing else in this repo today. I checked with `find` outside `node_modules`.
   - Edit 03 to match: §0.3, the §4.4 list/run examples, §8 `package.json`, and §11 TBC-1 (delete it).
2. **[non-blocking] §2.2 `resolveInsideProject`: the containment test is underspecified in two places.**
   - (a) A bare `rel.startsWith('..')` also refuses legitimate names such as `..config/x`. Use `rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)`.
   - (b) Step 4 returns a path relative to `realpath(cwd)`, but for a path that does not exist (allowed for T2, deleted files) there is no `realAbs`. Specify that the lexical relative path from step 2 is returned in that case.
   - Add one test each: `'..config'` is accepted, and a deleted file returns its lexical relative path.
3. **[non-blocking] Specified behaviour with no test:** the `createLogger` 10 MB cap (§2.4) and the `stop` force-kill branch (§5.4 step 3). Per the coding standards, add a unit test for the logger cap with a small `capBytes` and a fake stream. For the force-kill path, a test is optional, but `stop` should be structured so the 5 s wait can be injected.
4. **[non-blocking, for Security on TBC-2] The MCP routes (`/sse`, `/messages`) are not token-gated.** Any local user or process on the machine can therefore call `kinet_run_script` and `kinet_git_diff` against the project while a daemon runs. This is within the ACs (auth is Later item 7) and fine for Saurabh's single-user Mac, but Security should accept it explicitly in its sign-off rather than by omission. It should also be added to the README's 127.0.0.1 note.
