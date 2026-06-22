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
- Trigger logic delegated to a handler class (no inline trigger logic)
- No SOQL/DML inside loops
- Explicit `with sharing` / `without sharing` declaration on every class
- Bulkified for 1-200 record execution contexts

### Security
- CRUD/FLS enforcement (`WITH SECURITY_ENFORCED`, `Security.stripInaccessible`, or explicit checks) on user-facing queries/DML
- No hardcoded record/org IDs
- LWC: no `lwc:dom="manual"` misuse, no unescaped HTML via `innerHTML`

### Test Coverage
Apex test classes present, asserting behaviour (not just hitting coverage %). LWC Jest tests for new components.

### Approval
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION — with reasoning.
