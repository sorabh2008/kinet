---
description: Run a security audit of changed or specified files and report OWASP issues
---

1. Load the security skill via `kinet_get_skill` with skill="security"
2. If $ARGUMENTS is empty: `git diff main...HEAD --name-only` to find changed files
   If $ARGUMENTS is a path: audit that path
3. Search for known CVEs in dependencies via `kinet_web_search` for key packages in `package.json`
4. Run `kinet validate --json` for rule-based security violations

Produce a Security Report:

## Security Report — $ARGUMENTS

### Severity Summary
| Severity | Count |
|----------|-------|
| CRITICAL | |
| HIGH | |
| MEDIUM | |
| LOW | |
| INFO | |

### Findings

For each finding:
**[SEVERITY] Finding Title**
- File: path:line
- OWASP Category: e.g. A03:2021 Injection
- Description: What the issue is
- Recommendation: How to fix it

### Dependency CVEs
Any known vulnerabilities in packages used by changed files (check `package.json`/lockfile).

### Compliance
- Injection via string-built queries or unsanitised input passed to `exec`/`eval`
- Missing input validation on request bodies/params/query
- Missing/weak authentication or authorization middleware on new routes
- Secrets read from hardcoded strings instead of environment variables
- Missing rate limiting on public-facing endpoints
