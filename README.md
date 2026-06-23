# KINET

**AI Assistant Bridge for React / Node / Java / Python / Salesforce / Flutter Ecosystems**

KINET makes every AI interaction in your project aware of your stack, patterns, rules, and decisions. It eliminates the overhead of re-explaining your conventions and enforces consistency across all AI-assisted code.

---

## What KINET Does

| Component | What it provides |
|-----------|-----------------|
| **Context Distillation** | Scans your repo and generates `CLAUDE.md` — a rich context file AI assistants load automatically |
| **Rules Engine** | Enforces approved coding patterns; `kinet validate` reports violations |
| **AI Commands** | `/plan`, `/commit`, `/pr-review`, `/security` — structured prompts installed as Claude Code slash commands |
| **Skills** | Deep expertise modules: `planning`, `architecture`, `security`, `testing` |
| **PRP System** | Project Requirements & Patterns — human-authored context that can't be auto-detected |
| **Memory Store** | Persistent AI memories scoped to your project, queryable via MCP |
| **MCP Server** | Gives AI tools: web search, GitHub search, context/rules/memory on demand |

---

## Supported Stacks

| Stack | Detected via | Rules cover |
|-------|--------------|--------------|
| `react` | `package.json` (with `react` dependency) | HTTP-in-service-layer, no `any`, no inline styles, list keys, error boundaries |
| `node` | `package.json` (no `react` dependency) | No `require()` in ESM, no sync fs in handlers, async error handling, no DB calls in routes |
| `java` | `pom.xml` / `build.gradle` | Thin controllers, DTOs not entities, constructor injection, no field injection |
| `python` | `requirements.txt` / `pyproject.toml` / `setup.py` / `Pipfile` | No bare `except`, no mutable default args, type hints, no string-built SQL |
| `salesforce` | `sfdx-project.json` | No SOQL/DML in loops, `with sharing` declared, no hardcoded IDs, trigger handler pattern |
| `flutter` | `pubspec.yaml` | No HTTP/business logic in widgets, `mounted` check after async gaps, no empty catch, no `print()` |
| `fullstack` | `package.json` + `pom.xml` | React + Java rules combined |

Every stack also gets the `common` rules (no hardcoded secrets, no dead code, conventional commits) and the `env` rules — `.env`/`.env.*` files are scanned for real secret values regardless of stack.

---

## Quick Start

```bash
npm install -g kinet-ai     # install globally
cd your-project
kinet init                  # initialise KINET in this project
```

`kinet init` will:
1. Detect your stack (React / Node / Java / Python / Salesforce / Flutter / fullstack)
2. Distil project context from the codebase
3. Generate `CLAUDE.md`
4. Install `.claude/commands/` with `/plan`, `/commit`, `/pr-review`, `/security`
5. Configure the KINET MCP server in `.claude/settings.json`
6. Create `.kinet/` with context, rules, memory, and PRP files
7. Add `.claude`, `.kinet`, `CLAUDE.md`, and `kinet.config.json` to `.gitignore` (KINET's output is local by default — remove these lines if you want to share it via git)

---

## CLI Commands

```bash
kinet init                  # Initialise KINET in current project
kinet update                # Re-scan and refresh context + CLAUDE.md
kinet update --context      # Refresh context only
kinet update --rules        # Re-apply rule templates only
kinet update --memory       # Rebuild memory index only
kinet validate              # Check codebase against rules, exit 1 on violations
kinet validate --fix        # Auto-fix safe violations
kinet validate --json       # Machine-readable output
kinet refresh               # Pull latest core rule/skill templates from KINET
kinet status                # Show installation health for current project
kinet mcp                   # Start MCP server (called automatically by Claude Code)
```

---

## AI Commands (Claude Code Slash Commands)

Once initialised, these are available inside Claude Code:

| Command | What it does |
|---------|-------------|
| `/plan <feature>` | Generates a scoped implementation plan aligned to your stack and patterns |
| `/commit` | Validates staged changes against rules (including secret scanning of any staged `.env*` files), generates a Conventional Commit message |
| `/pr-review` | Reviews the current branch diff against KINET rules and team conventions |
| `/security [path]` | OWASP-focused security audit of changed or specified files |

---

## MCP Tools

The KINET MCP server exposes these tools to AI assistants:

| Tool | Description |
|------|-------------|
| `kinet_web_search` | Search the web (Brave API or DuckDuckGo) |
| `kinet_github_search` | Search GitHub org for code, issues, PRs |
| `kinet_get_context` | Retrieve distilled project context |
| `kinet_get_rules` | Get active rule set |
| `kinet_get_prp` | Get Project Requirements & Patterns |
| `kinet_memory_recall` | Query project AI memories |
| `kinet_memory_save` | Persist a new AI memory |
| `kinet_get_skill` | Load a skill definition |
| `kinet_validate` | Run rule validation and return report |

### Environment Variables for MCP

| Variable | Purpose |
|----------|---------|
| `BRAVE_API_KEY` | Brave Search API key (better search quality) |
| `GITHUB_TOKEN` | GitHub PAT (private repos + higher rate limit) |

---

## Project Structure After Init

```
your-project/
├── CLAUDE.md                  ← AI context (gitignored by default)
├── kinet.config.json          ← KINET config (gitignored by default)
├── .kinet/
│   ├── context/
│   │   └── distilled.json     ← auto-generated context
│   ├── rules/
│   │   ├── index.json
│   │   ├── common.md
│   │   ├── react.md           ← or java.md / fullstack.md
│   │   └── ...custom rules
│   ├── memory/
│   │   ├── index.json
│   │   └── *.md               ← memory entries
│   ├── prp/
│   │   ├── requirements.md    ← edit: what the system must do
│   │   ├── patterns.md        ← edit: approved patterns
│   │   ├── decisions.md       ← edit: ADRs
│   │   └── context.md         ← edit: injected into CLAUDE.md
│   └── skills/                ← project-level skill overrides
└── .claude/
    ├── settings.json          ← MCP server config
    └── commands/
        ├── plan.md
        ├── commit.md
        ├── pr-review.md
        └── security.md
```

---

## PRP System — What to Edit

After `kinet init`, edit these files to capture your team's knowledge:

**`.kinet/prp/requirements.md`** — functional and non-functional requirements  
**`.kinet/prp/patterns.md`** — approved patterns (pre-populated from code scan)  
**`.kinet/prp/decisions.md`** — Architecture Decision Records (ADRs)  
**`.kinet/prp/context.md`** — free-form context injected verbatim into `CLAUDE.md`  

Run `kinet update` after editing PRP files to regenerate `CLAUDE.md`.

---

## Customising Rules

Rules live in `.kinet/rules/`. Each `.md` file defines rules as `## Rule Name` sections.

To add a custom rule — create `.kinet/rules/custom.md`:
```markdown
## No Legacy API Client
Do not import from `src/legacy/api`. Use `src/services/` instead.
**Applies to:** src/**/*.ts
```

To add a validator for programmatic enforcement — extend `.kinet/rules/validators/`.

---

## Workflow Example

```bash
# Day 1
cd my-app
kinet init                              # CLAUDE.md, .kinet/, .claude/, kinet.config.json are gitignored by default

# Optional — share KINET's setup with your team instead of keeping it local:
# remove the "# KINET" block from .gitignore, then:
# git add CLAUDE.md kinet.config.json .kinet/ .claude/
# git commit -m "chore: initialise KINET"

# Working session
# Open Claude Code — it loads CLAUDE.md automatically
# Type /plan "add user profile page"   ← structured plan
# Implement the feature
# Type /commit                          ← validates + generates message
# Type /pr-review                       ← review before pushing

# After adding new domain logic
kinet update                            ← refresh context
```

---

## Adding KINET to a Monorepo

Run `kinet init` in each sub-project directory separately. Each gets its own `.kinet/` and `CLAUDE.md`.

For shared rules across a monorepo, create a root-level `.kinet/rules/shared.md` and symlink or copy to each sub-project.

---

## Keeping KINET Current

- Run `kinet refresh` after KINET updates to pull the latest rule and skill templates
- Run `kinet update` after significant refactors to keep `CLAUDE.md` accurate
- `kinet validate` in CI catches rule violations before merge

```yaml
# .github/workflows/kinet.yml
- name: KINET validate
  run: npx kinet-ai validate --json
```

---

## Licence

MIT
