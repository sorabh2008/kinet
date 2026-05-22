import { join } from 'path';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * PRP = Project Requirements & Patterns
 *
 * The PRP system stores hand-authored, evolving project knowledge that cannot be
 * auto-detected from the codebase. It has three layers:
 *
 *   prp/requirements.md  — what the system must do (functional & non-functional)
 *   prp/patterns.md      — approved patterns and their rationale
 *   prp/decisions.md     — architecture decision records (ADRs)
 *   prp/context.md       — free-form context injected into CLAUDE.md
 *
 * These are human-maintained. KINET never overwrites them after init.
 */
export class PrpSystem {
  constructor(kinetDir) {
    this.prpDir = join(kinetDir, 'prp');
  }

  async init(config, context) {
    mkdirSync(this.prpDir, { recursive: true });

    const files = {
      'requirements.md': buildRequirements(config),
      'patterns.md': buildPatterns(context),
      'decisions.md': buildDecisions(config, context),
      'context.md': buildContextTemplate(config),
    };

    for (const [filename, content] of Object.entries(files)) {
      const path = join(this.prpDir, filename);
      if (!existsSync(path)) {
        writeFileSync(path, content);
      }
    }
  }

  getAll() {
    const files = ['requirements.md', 'patterns.md', 'decisions.md', 'context.md'];
    const result = {};
    for (const f of files) {
      const path = join(this.prpDir, f);
      result[f] = existsSync(path) ? readFileSync(path, 'utf8') : '';
    }
    return result;
  }
}

function buildRequirements(config) {
  return `# Project Requirements

> Edit this file to capture functional and non-functional requirements.
> These are injected into AI context so every interaction stays aligned with what the system must do.

## Functional Requirements

<!-- Add key user stories or features here -->
<!-- Example: -->
<!-- - Users must be able to authenticate via SSO -->
<!-- - The API must respond within 200ms at p95 -->

## Non-Functional Requirements

- Performance: <!-- e.g. API p95 < 200ms -->
- Accessibility: <!-- e.g. WCAG 2.1 AA -->
- Security: <!-- e.g. OWASP Top 10 compliance -->
- Browser support: <!-- e.g. last 2 versions of Chrome/Firefox/Safari -->
- Java version: <!-- e.g. Java 21 LTS -->

## Out of Scope

<!-- Document explicitly what this project does NOT do -->
`;
}

function buildPatterns(context) {
  const lines = [`# Approved Patterns

> These are the patterns approved for use in this project.
> When an AI suggests an alternative, it must justify why it deviates from this list.

`];

  if (context.stack === 'react' || context.stack === 'fullstack') {
    lines.push(`## React Patterns

### Component Organisation
- One component per file
- Co-locate test files (\`Button.test.tsx\` next to \`Button.tsx\`)
- Barrel exports via \`index.ts\` in each directory

### Data Fetching
- All API calls go through \`src/services/\` — never call fetch/axios in components
- Use ${context.patterns?.fetchStrategy || 'custom hooks'} for server state

### State Management
- Local component state: \`useState\` / \`useReducer\`
- Global state: ${context.tech?.stateManagement || 'see tech stack'}
- Never use Redux for form state — use react-hook-form or controlled components

### Error Handling
- Each route has an ErrorBoundary
- API errors are handled in the service layer and surfaced as typed Error objects

`);
  }

  if (context.stack === 'java' || context.stack === 'fullstack') {
    lines.push(`## Java / Spring Patterns

### Layered Architecture (strict)
\`\`\`
Controller → Service → Repository
Controller → Service → ExternalServiceClient
\`\`\`
- Controllers: receive request, delegate to service, return response — no business logic
- Services: own all business logic, marked @Transactional where needed
- Repositories: Spring Data only — no JPQL in controllers or services unless unavoidable

### Dependency Injection
- Constructor injection only (Lombok @RequiredArgsConstructor)
- No @Autowired field injection

### Exception Handling
- Define project exception hierarchy: BaseException → DomainException, ValidationException
- Handle all exceptions in a single @ControllerAdvice class
- Never swallow exceptions silently

### DTOs
- Separate DTOs per API operation (RequestDto, ResponseDto)
- Never expose JPA entities via REST API
- Use MapStruct for mapping between entity and DTO

`);
  }

  return lines.join('');
}

function buildDecisions(config, context) {
  return `# Architecture Decision Records

> Log significant architecture decisions here.
> Format: ## ADR-NNN: Title\\n**Status**: Accepted|Superseded|Deprecated\\n**Context**: ...\\n**Decision**: ...\\n**Consequences**: ...

## ADR-001: Initial Tech Stack Selection

**Status**: Accepted
**Date**: ${new Date().toISOString().split('T')[0]}

**Context**: Starting project configuration captured by KINET init.

**Decision**:
${context.stack === 'react' || context.stack === 'fullstack' ? `- Frontend: React${context.tech?.typescript ? ' + TypeScript' : ''} with ${context.tech?.bundler || 'unknown bundler'}\n` : ''}${context.stack === 'java' || context.stack === 'fullstack' ? `- Backend: Java ${context.tech?.javaVersion || ''} + ${context.tech?.springBoot ? 'Spring Boot' : 'plain Java'} (${context.tech?.buildTool || 'maven'})\n` : ''}
**Consequences**: All future development must align with these choices unless a new ADR supersedes this one.

---

<!-- Add new ADRs above this line -->
`;
}

function buildContextTemplate(config) {
  return `# Project-Specific Context

> This file is injected verbatim at the bottom of CLAUDE.md.
> Use it for context that can't be auto-detected: business domain, team conventions, external systems, gotchas.

## Business Domain

<!-- Describe what this system does in plain English -->
<!-- Example: "This is an order management system for a B2B marketplace. Orders can be in states: draft, submitted, approved, shipped, delivered." -->

## Team Conventions

<!-- Document non-obvious team agreements -->
<!-- Example: "We use feature flags via LaunchDarkly — never ship dead code paths without a flag" -->

## External Systems

<!-- List external dependencies and quirks -->
<!-- Example: "Legacy ERP system exposes SOAP API at /erp/v1 — do not attempt REST refactor" -->

## Known Gotchas

<!-- Warn about non-obvious things that have caused bugs before -->

## Glossary

<!-- Define domain-specific terms so AI doesn't misinterpret them -->
`;
}
