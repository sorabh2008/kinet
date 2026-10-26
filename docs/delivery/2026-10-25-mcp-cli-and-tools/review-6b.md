APPROVED

# Review 6b: Security stage (06-security.md)

Reviewer gate on `06-security.md`, checked against `02-architecture.md`, `03-design.md` and `git diff develop...feature/mcp-cli-and-tools` (focus `src/mcp/`, `src/cli/mcp.js`, `src/utils/`). Read-only: I read the code but did not run tests or servers, because the Developer is fixing on the branch at the same time.

The Security review is accurate, the severities are justified, and the blocking vs non-blocking split is right. TBC-2 and the SDK reasoning hold up. The items below are additions and corrections for Security or the Developer to fold in. None of them changes the verdict.

## Spot-checks (confirmed)

- **Finding 1 (symlink, BLOCKING) is real.** `src/mcp/runstate.js:65` does `writeFile(tmp, ..., { mode: 0o600 })`. That follows a planted `mcp.json.tmp` link, and `mode` only applies when the file is created. The `rename` on line 66 then turns `mcp.json` into the link. `ensureRunDir` (line 43) accepts a symlinked `.kinet` or `.kinet/run` and creates the dir as 0755. `kinet mcp start` runs no repo code otherwise, so this gives a cloned repo a new capability. Medium severity and blocking are right, and the fix is small.
- **Finding 3 (pathspec) is real.** `resolveInsideProject` (`src/utils/args.js:32-37`) turns `:(top)` / `:/x` into a relative name that does not exist and returns it unchanged. `buildDiffArgs` (`git-diff.js:34-41`) passes it after `--`, where git still applies pathspec magic. Low is right, because a bare `git diff` from a subdirectory already shows the whole repo. `find-todos.js:101` stats the path first, which is why that tool is mostly protected, as the doc says.
- **TBC-2 is sound.** The Host check is an exact match on `127.0.0.1:<port>` / `localhost:<port>`, the bind is 127.0.0.1 only, and the Origin allowlist is `http.js:7-15,73-74`. Together these defeat DNS rebinding. A cross-site EventSource or fetch carries `Origin` and is refused. The one gap is a no-cors subresource, which finding 4 covers correctly as DoS only.
- **The SDK audit reasoning is sound.** `package-lock.json` is not tracked, and `package.json` declares `"@modelcontextprotocol/sdk": "^1.12.0"`. `grep -ri taskstore src` finds nothing. Raising the floor to `^1.32.0` as recommended-not-required is the right call.
- **Accepting finding 2 for v1 fits the scope docs.** It matches 01 §6 Later item 7 and 03 §6 line 513 (MCP routes are not token-gated in v1). The README condition is concrete and checkable: `README.md:98` still says "(Wording pending Security sign-off.)".

## Findings (all non-blocking)

1. **Missed: git config can run commands in an untrusted checkout.** Low.
   - `git status` and `git diff` run `core.fsmonitor`. `git diff` also runs a `diff.<driver>.textconv` that `.gitattributes` points at, and `.gitattributes` is committed. `--no-ext-diff` does not cover either one.
   - A plain `git clone` does not bring `.git/config`, but an extracted archive or zip that ships a `.git/` directory does. Through MCP, the agent triggers these git calls without the user typing anything.
   - Fix (cheap): add `-c core.fsmonitor=false` to the git calls in `git-common.js`, `git-status.js`, `git-diff.js` and `find-todos.js`, and add `--no-textconv` to `buildDiffArgs`. Record this in 06 as finding 6(d), or defer it explicitly.
2. **Finding 1 overstates the log vector.** In `src/cli/mcp.js:151-152`, `rotateLog` renames `mcp.log` (and so any planted link) to `mcp.log.1` before `spawnDaemon` opens `mcp.log` with `'a'`. A planted `mcp.log` symlink is therefore not written through today. `O_NOFOLLOW` on the log is still worth adding as defence in depth, but 06 should not list it as an exploitable path. `.gitignore` and `mcp.lock` use `'wx'` (O_EXCL), so they are already safe. The live vectors are the `mcp.json.tmp` link and a symlinked `.kinet` / `.kinet/run`.
3. **Make the finding 1 test cover the directory case too.** Besides the planted `mcp.json.tmp` link, add a case where `.kinet/run` is a symlink to a scratch dir. Assert that `ensureRunDir` refuses and writes nothing into the link target. Without this, the `lstat` check is untested.
4. **Finding 3 fix: note the behaviour change.** Prefixing `:(literal)` in `buildGrepArgs` turns off glob matching for the user's `path`. That is acceptable, because the tool schema says "subdirectory or file", but the test should state it. Also check that `git --literal-pathspecs diff` is applied to both the `--stat` call and the patch call. Both go through `buildDiffArgs`, so one change covers them.
5. **Nit: verdict keyword.** 06 ends with "CHANGES REQUIRED". The pipeline keyword is `CHANGES_REQUESTED`. Use the exact keyword so the gate can match it.
