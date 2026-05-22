# Security Skill

**Applies to:** React, Java/Spring, fullstack

When this skill is active, apply OWASP Top 10 (2021) analysis to all code under review.

## OWASP Categories to Check

### A01 — Broken Access Control
- Java: Verify `@PreAuthorize` / `@Secured` annotations on all controller methods
- Java: Ensure Spring Security config doesn't expose unintended endpoints
- React: Check that protected routes enforce auth before rendering

### A02 — Cryptographic Failures
- No hardcoded secrets, keys, or passwords (flag these as CRITICAL)
- Passwords hashed with bcrypt/argon2, never MD5/SHA1
- TLS required for all external calls
- Sensitive fields not logged

### A03 — Injection
- Java: JPA queries — parameterized only; no string concatenation into JPQL/SQL
- Java: Use `@Valid` + Bean Validation on all `@RequestBody` parameters
- React: No `dangerouslySetInnerHTML` with user content
- React: Validate all query params before rendering

### A05 — Security Misconfiguration
- Java: CORS configured explicitly — no `allowAllOrigins()`
- Java: Spring Boot Actuator endpoints secured
- Java: CSRF protection enabled (or explicitly disabled for stateless JWT APIs with justification)
- React: CSP headers configured (check `meta` tags or server headers)

### A06 — Vulnerable and Outdated Components
- Flag dependencies with known CVEs (search `kinet_web_search` for "$package CVE 2024 2025")
- Transitive dependencies in pom.xml / package.json

### A07 — Identification and Authentication Failures
- JWT: check expiry, signature algorithm (reject `none` / HS256 with weak secret)
- Session tokens: secure, httpOnly, sameSite cookies
- Password policy enforced
- Rate limiting on auth endpoints

### A09 — Security Logging and Monitoring Failures
- Authentication events logged
- Authorization failures logged at WARN level
- Sensitive data (passwords, tokens, PII) never in logs
- Java: SLF4J with structured logging; no System.out

## Severity Classification

| Level | Example |
|-------|---------|
| CRITICAL | Hardcoded secret, auth bypass, SQL injection |
| HIGH | Missing authorization check, XSS, CSRF on mutation |
| MEDIUM | Missing input validation, verbose errors in API response |
| LOW | Missing rate limit, overly permissive CORS on read-only endpoint |
| INFO | Dependency update recommended, logging improvement |

## Reporting Format

```
**[SEVERITY] Title**
File: path/to/file.java:42
OWASP: A01:2021
What: explain the vulnerability
Why it matters: attack scenario
Fix: concrete code change
```
