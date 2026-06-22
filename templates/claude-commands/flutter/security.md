---
description: Run a security audit of changed or specified files and report OWASP issues
---

1. Load the security skill via `kinet_get_skill` with skill="security"
2. If $ARGUMENTS is empty: `git diff main...HEAD --name-only` to find changed files
   If $ARGUMENTS is a path: audit that path
3. Search for known CVEs in dependencies via `kinet_web_search` for key packages in `pubspec.yaml`
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
- Category: e.g. insecure storage, weak TLS validation
- Description: What the issue is
- Recommendation: How to fix it

### Dependency CVEs
Any known vulnerabilities in packages used by changed files (check `pubspec.yaml`/`pubspec.lock`).

### Compliance
- Tokens/credentials stored in `SharedPreferences` instead of `flutter_secure_storage`
- Missing certificate pinning for sensitive API calls
- Hardcoded API keys/secrets in Dart source
- Sensitive data logged via `print()`/`debugPrint()`
- WebView usage with JavaScript enabled and unsanitised content
