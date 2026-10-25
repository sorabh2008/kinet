APPROVED

# Review 1 — Product Owner stage (01-requirement.md)

## Round 2

The revised requirement fixes all eight Round 1 findings:

- R1-1 (binding): fixed. AC-6.2 now makes `--port` localhost-only as an explicit, README-documented change. AC-7.6 sets localhost-only binding for `start`, with a test. `--host` is deferred.
- R1-2 (argument injection / path escape): fixed. AC-0.8 covers the leading-`-` refusal, the `--` separator and keeping paths inside the project, with a concrete test for each.
- R1-3 (async commands): fixed in AC-0.9.
- R1-4 (lint and test glob): fixed. AC-11.1 quotes the glob and requires a non-zero test count. AC-11.2 adds an ESLint flat config.
- R1-5 (ticket pattern): fixed in AC-3.2.
- R1-6 (PID reuse): fixed. AC-8.3 and AC-9.3 require an identity check; the Architect picks the mechanism.
- R1-7 (scope assumption): now marked "to confirm with Saurabh at close-out".
- R1-8 (DNS rebinding): raised as an open question for Security in section 8.

Remaining findings (none blocking):

1. **[non-blocking] AC-7.2 prints `http://localhost:<port>/sse`, but the server binds to `127.0.0.1` only.** On macOS, some clients resolve `localhost` to `::1` first and get connection refused. Print and document `http://127.0.0.1:<port>/sse` instead. The Developer can fix this without another PO round.
2. **[non-blocking] AC-3.2 wording.** The regex at `src/rules/validators/common.js:47` is a "TODO without ticket" matcher, and `TODO` is hard-coded into it. "Share the pattern, applied to every marker" really means pulling the ticket fragment (`\s*\[#?\w+[-_]\d+\]`) into a shared constant that both the validator and T3 use. The intent is clear; the Solution Designer should spell this out.
