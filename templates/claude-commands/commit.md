---
description: Validate staged changes and generate a conventional commit message
---

1. Run `git diff --staged --name-only` to see staged files. If any staged file is `.env` or matches `.env.*` (excluding `.env.example`/`.env.sample`/`.env.template`), run `git diff --staged -- <file>` and scan its contents for real secret values (API keys, tokens, passwords, private keys) — not placeholders like `changeme`/`your-api-key`. If a real secret is found, or if a non-example env file is staged at all, stop and warn the user; do not propose a commit message until it's unstaged or the secret is removed/rotated.
2. Run `git diff --staged` to see what's staged
3. Run `kinet validate --json` via Bash to check for rule violations in changed files — this also scans tracked `.env*` files for secrets via the `env/*` rules
4. If there are violations with severity=error, report them and stop — do not generate a commit message until fixed
5. If only warnings, include them in the commit body

Then generate a commit message following the Conventional Commits spec:

```
<type>(<scope>): <short summary>

<body — what changed and why, not how>

<KINET validate: N warnings | clean>
```

**Types**: feat, fix, refactor, test, chore, docs, perf, ci

**Rules**:
- Subject line ≤ 72 chars, lowercase, no period
- Body wraps at 72 chars
- Reference ticket IDs: "Closes #123" or "Refs PROJ-456"
- No emojis unless the project uses them

Propose the message — do not run `git commit` until the user approves.
