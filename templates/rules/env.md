# Environment File Rules

**Applies to:** `.env`, `.env.*` files in any project

## No Secrets In Env Files
Never commit real secret values (API keys, tokens, passwords, private keys) into a tracked `.env` file.
Placeholder values (`changeme`, `your-api-key`, `<replace-me>`) are fine in `.env.example`.
**Why:** `.env` files are easy to commit by accident, and once a secret hits git history it must be treated as compromised and rotated.

## Env Files Should Not Be Tracked
`.env`, `.env.local`, `.env.production`, etc. should be gitignored. Only `.env.example` / `.env.sample` / `.env.template` (with placeholder values) belong in version control.
**Why:** Real environment files hold per-environment secrets that differ by developer/deployment and must never be shared via git.
