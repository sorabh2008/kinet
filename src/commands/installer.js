import { join } from 'path';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(__dirname, '../../templates/claude-commands');

export async function installClaudeCommands(cwd, stack) {
  const commandsDir = join(cwd, '.claude', 'commands');
  mkdirSync(commandsDir, { recursive: true });

  const commands = {
    'plan.md': planCommand(stack),
    'commit.md': commitCommand(),
    'pr-review.md': prReviewCommand(stack),
    'security.md': securityCommand(stack),
  };

  for (const [filename, content] of Object.entries(commands)) {
    writeFileSync(join(commandsDir, filename), content);
  }
}

function planCommand(stack) {
  return `---
description: Generate an implementation plan aligned to this project's stack and KINET rules
---

You are planning a feature for this project. Before writing any code:

1. Load KINET context via the \`kinet_get_context\` MCP tool
2. Load active rules via \`kinet_get_rules\`
3. Load the planning skill via \`kinet_get_skill\` with skill="planning"
4. Load PRP patterns via \`kinet_get_prp\` with section="patterns"

Then produce a plan with:

## Plan: $ARGUMENTS

### Scope
What will and won't be built.

### Architecture
How this fits into the existing ${stack === 'java' || stack === 'fullstack' ? 'layered architecture (Controller → Service → Repository) ' : ''}${stack === 'react' || stack === 'fullstack' ? 'React component hierarchy and service layer ' : ''}structure.

### Files to Create / Modify
A concrete list. No file should be listed unless it will actually change.

### Implementation Steps
Numbered, ordered by dependency. Each step should be small enough to complete in one Claude Code session.

### Tests
What tests are required. Follow the project's testing conventions.

### KINET Rule Check
Flag any rules that this change touches.

Do not write any code yet — wait for approval.
`;
}

function commitCommand() {
  return `---
description: Validate staged changes and generate a conventional commit message
---

1. Run \`git diff --staged\` to see what's staged
2. Run \`kinet validate --json\` via Bash to check for rule violations in changed files
3. If there are violations with severity=error, report them and stop — do not generate a commit message until fixed
4. If only warnings, include them in the commit body

Then generate a commit message following the Conventional Commits spec:

\`\`\`
<type>(<scope>): <short summary>

<body — what changed and why, not how>

<KINET validate: N warnings | clean>
\`\`\`

**Types**: feat, fix, refactor, test, chore, docs, perf, ci

**Rules**:
- Subject line ≤ 72 chars, lowercase, no period
- Body wraps at 72 chars
- Reference ticket IDs: "Closes #123" or "Refs PROJ-456"
- No emojis unless the project uses them

Propose the message — do not run \`git commit\` until the user approves.
`;
}

function prReviewCommand(stack) {
  return `---
description: Review the current branch diff against KINET rules and team conventions
---

1. Run \`git diff main...HEAD\` (or \`git diff origin/main...HEAD\` if main is remote)
2. Run \`kinet validate --json\` on the branch
3. Load rules via \`kinet_get_rules\`
4. Load PRP patterns via \`kinet_get_prp\` with section="patterns"
5. Search for related patterns in the codebase via \`kinet_github_search\`

Produce a PR review with:

## PR Review

### Summary
What this PR does in 2-3 sentences.

### KINET Rule Violations
List any violations from \`kinet validate\`. Flag severity.

### Code Quality
${stack === 'react' || stack === 'fullstack' ? `- Component structure and separation of concerns
- TypeScript types (no \`any\`, proper interfaces)
- State management approach
- Data fetching patterns (correct use of ${stack}-specific patterns)
` : ''}${stack === 'java' || stack === 'fullstack' ? `- Layering compliance (no business logic in controllers)
- DTO usage (no entities in API layer)
- Transaction boundaries
- Exception handling approach
` : ''}
### Security
Any OWASP concerns in the diff. Flag HIGH/MEDIUM/LOW.

### Test Coverage
Are the changes adequately tested per project conventions?

### Approval
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION — with reasoning.
`;
}

function securityCommand(stack) {
  return `---
description: Run a security audit of changed or specified files and report OWASP issues
---

1. Load the security skill via \`kinet_get_skill\` with skill="security"
2. If $ARGUMENTS is empty: \`git diff main...HEAD --name-only\` to find changed files
   If $ARGUMENTS is a path: audit that path
3. Search for known CVEs in dependencies via \`kinet_web_search\` for key packages
4. Run \`kinet validate --json\` for rule-based security violations

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
- OWASP Category: e.g. A01:2021 Broken Access Control
- Description: What the issue is
- Recommendation: How to fix it

### Dependency CVEs
Any known vulnerabilities in packages used by changed files.

### Compliance
${stack === 'java' || stack === 'fullstack' ? `- Spring Security configuration review
- JWT/session handling
- SQL injection via JPA/JDBC
` : ''}${stack === 'react' || stack === 'fullstack' ? `- XSS vectors in React (dangerouslySetInnerHTML etc.)
- CSRF token handling
- Sensitive data in localStorage/sessionStorage
` : ''}
`;
}
