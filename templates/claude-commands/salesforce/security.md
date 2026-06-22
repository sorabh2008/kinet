---
description: Run a security audit of changed or specified files and report OWASP issues
---

1. Load the security skill via `kinet_get_skill` with skill="security"
2. If $ARGUMENTS is empty: `git diff main...HEAD --name-only` to find changed files
   If $ARGUMENTS is a path: audit that path
3. Run `kinet validate --json` for rule-based security violations

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
- Category: e.g. CRUD/FLS bypass, SOQL injection, sharing violation
- Description: What the issue is
- Recommendation: How to fix it

### Compliance
- SOQL injection via dynamic query string concatenation with unescaped user input (use `String.escapeSingleQuotes` or bind variables)
- Missing CRUD/FLS enforcement on DML and SOQL triggered by user input
- Classes without an explicit sharing declaration touching sensitive objects
- Hardcoded credentials/endpoints for callouts (should be Named Credentials)
- LWC: XSS via unescaped HTML insertion, exposed Apex methods without `@AuraEnabled(cacheable=true)` access checks
