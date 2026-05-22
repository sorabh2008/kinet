# Common Rules

**Applies to:** all files

## No Hardcoded Secrets
Never commit passwords, API keys, tokens, or private keys in source code.
Store secrets in environment variables, `.env` files (gitignored), or a secrets manager.
CI pipelines must use secret variables, not hardcoded values.

## No TODO Without Ticket
Every TODO must reference a tracked issue: `TODO [PROJ-123]`.
Undated, unlinked TODOs become permanent and rot.

## Conventional Commits
All commit messages follow the Conventional Commits spec:
`<type>(<scope>): <summary>` — types: feat, fix, refactor, test, chore, docs, perf, ci.

## No Dead Code
Remove code instead of commenting it out.
Git history preserves deleted code — commented-out code is noise.

## Dependency Approval
New production dependencies require a comment in the PR explaining:
why it was chosen, what alternatives were considered, and its licence.
