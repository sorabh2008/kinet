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

  if (context.stack === 'python') {
    lines.push(`## Python Patterns

### Style
- Type hints on all public function signatures
- ${context.tech?.packageManager || 'pip'} for dependency management — pin versions in ${context.tech?.packageManager === 'poetry' ? 'pyproject.toml' : 'requirements.txt'}
- Never use mutable default arguments

### Errors & Logging
- No bare \`except:\` — catch specific exception types
- \`logging\` module, not \`print()\`, outside of scripts

### Data Access
- Parameterized queries only — never build SQL via string formatting/concatenation
${context.tech?.orm && context.tech.orm !== 'none' ? `- ORM: ${context.tech.orm}` : ''}

`);
  }

  if (context.stack === 'salesforce') {
    lines.push(`## Salesforce Patterns

### Apex
- Every class declares \`with sharing\` / \`without sharing\` / \`inherited sharing\` explicitly
- Bulkify all trigger/batch logic — never assume a single-record execution context
- No SOQL or DML inside loops
- Triggers delegate immediately to a handler class (one trigger per object)

### Security
- Enforce CRUD/FLS on user-facing SOQL/DML (\`WITH SECURITY_ENFORCED\` or \`Security.stripInaccessible\`)
- No hardcoded record/org IDs — query by a stable external key instead

### Components
- New UI work uses Lightning Web Components, not Aura, unless extending an existing Aura component

`);
  }

  if (context.stack === 'node') {
    lines.push(`## Node Patterns

### Layering
- Routes/controllers receive the request, delegate to a service, return the response — no business logic in route handlers
- Data access goes through ${context.tech?.orm && context.tech.orm !== 'none' ? context.tech.orm : 'a dedicated data-access layer'}, not inline in routes

### Errors
- Async handlers wrapped in try/catch or routed through centralised error-handling middleware
- Fail fast on missing required environment variables at startup

### Validation
- Request validation via ${context.patterns?.validationLibrary && context.patterns.validationLibrary !== 'none' ? context.patterns.validationLibrary : 'a schema validation library'} at the boundary

`);
  }

  if (context.stack === 'flutter') {
    lines.push(`## Flutter Patterns

### Architecture
- Widgets stay presentational — network/business logic lives in a repository/service class
- State management: ${context.tech?.stateManagement && context.tech.stateManagement !== 'none' ? context.tech.stateManagement : 'see tech stack'} — use this consistently, don't mix approaches

### Async Safety
- Always check \`mounted\` before using \`BuildContext\` after an \`await\`
- Never leave a \`catch\` block empty — log or rethrow

### Performance
- Use \`const\` constructors wherever the subtree is static
- Prefer \`ListView.builder\`/\`GridView.builder\` over building full lists eagerly

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
${context.stack === 'react' || context.stack === 'fullstack' ? `- Frontend: React${context.tech?.typescript ? ' + TypeScript' : ''} with ${context.tech?.bundler || 'unknown bundler'}\n` : ''}${context.stack === 'java' || context.stack === 'fullstack' ? `- Backend: Java ${context.tech?.javaVersion || ''} + ${context.tech?.springBoot ? 'Spring Boot' : 'plain Java'} (${context.tech?.buildTool || 'maven'})\n` : ''}${context.stack === 'python' ? `- Backend: Python ${context.tech?.pythonVersion || ''} + ${context.tech?.framework !== 'none' ? context.tech?.framework : 'no web framework'} (${context.tech?.packageManager || 'pip'})\n` : ''}${context.stack === 'salesforce' ? `- Platform: Salesforce (API v${context.tech?.apiVersion || 'unknown'})${context.tech?.usesLwc ? ' + Lightning Web Components' : ''}\n` : ''}${context.stack === 'node' ? `- Backend: Node${context.tech?.typescript ? ' + TypeScript' : ''} with ${context.tech?.framework !== 'none' ? context.tech?.framework : 'no framework'} (${context.tech?.packageManager || 'npm'})\n` : ''}${context.stack === 'flutter' ? `- Mobile: Flutter (Dart ${context.tech?.dartSdk || ''}) with ${context.tech?.stateManagement !== 'none' ? context.tech?.stateManagement : 'local state only'}\n` : ''}
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
