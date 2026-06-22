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
- No HTTP/business logic directly in widgets — repository/service layer used
- `BuildContext` checked against `mounted` after every async gap
- No empty catch blocks
- Consistent state management approach with the rest of the codebase

### Security
Any concerns in the diff (insecure storage of tokens/credentials, missing certificate pinning for sensitive APIs, secrets in code). Flag HIGH/MEDIUM/LOW.

### Test Coverage
Widget/unit tests present for new logic per project conventions.

### Approval
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION — with reasoning.
