---
description: Review the current branch diff against KINET rules and team conventions
---

1. Run `git diff main...HEAD` (or `git diff origin/main...HEAD` if main is remote)
2. Run `kinet validate --json` on the branch
3. Load rules via `kinet_get_rules`
4. Load PRP patterns via `kinet_get_prp` with section="patterns"
5. Search for related patterns in the codebase via `kinet_github_search`

Produce a PR review with:

## PR Review

### Summary
What this PR does in 2-3 sentences.

### KINET Rule Violations
List any violations from `kinet validate`. Flag severity.

### Code Quality
- Route/controller thinness — business logic lives in services
- Async error handling (try/catch or error middleware on every handler)
- No synchronous blocking calls in request handlers
- No `require()` left over in an ESM package

### Security
Any OWASP concerns in the diff (injection, missing input validation, secrets in code, missing rate limiting/auth middleware). Flag HIGH/MEDIUM/LOW.

### Test Coverage
Are the changes adequately tested per project conventions?

### Approval
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION — with reasoning.
