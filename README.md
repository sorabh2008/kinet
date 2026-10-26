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
| **MCP Server** | Gives AI tools: web search, GitHub search, context/rules/memory on demand, plus live repo state (git status/diff, open markers, npm scripts, dependency health) |
| **Delivery Team** | Links your personal team — role agents, team commands, skills, ways of working — into every project (see below) |

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
kinet update --team         # Re-link the delivery team only
kinet validate              # Check codebase against rules, exit 1 on violations
kinet validate --fix        # Auto-fix safe violations
kinet validate --json       # Machine-readable output
kinet refresh               # Pull latest core rule/skill templates from KINET
kinet status                # Show installation health for current project
kinet mcp                   # Start the stdio MCP server (called automatically by Claude Code)
kinet mcp --port <n>        # Run the HTTP/SSE MCP server in the foreground on 127.0.0.1:<n>
kinet mcp start [--port <n>]  # Start a background HTTP/SSE MCP server for this project (default port 7345)
kinet mcp status            # Show whether it is running (exit 0 running, 1 stopped, 2 unresponsive)
kinet mcp stop              # Stop it (graceful, then force-kill after 5 s)
kinet mcp logs [-n <lines>] [-f]  # Show the last 50 (or n) log lines; -f follows until Ctrl-C
```

### Background MCP server (`kinet mcp start|status|stop|logs`)

Bare `kinet mcp` is unchanged: it is the stdio server that Claude Code launches from `.claude/settings.json`, and you never run it yourself. The subcommands manage an optional **background HTTP/SSE server**, one per project directory, for clients that connect over a URL:

```bash
kinet mcp start             # prints pid, port, URL and log path
kinet mcp status
kinet mcp logs -f
kinet mcp stop
```

- URL: `http://127.0.0.1:7345/sse` (use `127.0.0.1`, not `localhost`, as some clients try IPv6 first).
- Run files live in `<project>/.kinet/run/` (state, log, previous log), which ignores itself in git even if `kinet init` never ran. The log is rotated on each `start` (one previous run is kept as `mcp.log.1`) and capped at 10 MB per run. It records start, each tool call (name, duration, ok/error; never argument values) and shutdown.
- `status` and `stop` only act on a process that proves it is this project's server (per-start token and project path checked over `/health`), so a reused PID, or a run-state file copied along with the project, never makes kinet signal another process.
- If the server's process is alive but `/health` does not answer (for example a hung process), `status` prints `unresponsive` and exits 2, `start` refuses to start a second one, and `stop` force-kills it.

**Security notes**

- **Behaviour change:** `kinet mcp --port <n>` and `kinet mcp start` now bind to `127.0.0.1` only (previously `--port` listened on all interfaces). A `--host` option is not available yet; it will only come after the MCP routes are token-gated.
- Requests whose `Host` header is not `127.0.0.1:<port>`/`localhost:<port>`, or that carry a foreign browser `Origin`, are refused (blocks DNS rebinding from web pages).
- The MCP routes themselves (`/sse`, `/messages`) are **not token-gated**: while the background server runs, any other local user account or process on the machine can call its tools as you, including `kinet_run_script` (your project's npm scripts, with your environment) and `kinet_git_diff`. Only run it on a machine you do not share. Token-gating these routes is planned and will ship before any `--host` option.
- If the server is force-killed (`kill -9`, or the `stop` fallback), an npm script started by `kinet_run_script` that is still running can be left orphaned. A normal `stop`, SIGTERM or Ctrl-C kills it.
- Windows is best effort: the lifecycle commands and git tools should work, but `kinet_run_script` and `kinet_check_deps` refuse on Windows in this version. macOS and Linux are supported.

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

## Delivery Team

KINET can wire a personal delivery team into every project it initialises. The team lives **outside** KINET in a team dir — `~/second-brain/_shared` by default, override with `KINET_TEAM_DIR` — so your own personas and ways of working never ship in this package:

```
<team dir>/
├── agents/*.md            ← role agents (Claude Code subagent format)
├── commands/*.md          ← team slash commands
├── skills/<name>/SKILL.md ← team skills (e.g. retro)
├── knowledge/ways-of-working.md, coding-standards.md
└── team-lead.md           ← routing rules: assign a role, execute, retro
```

`kinet init` and `kinet update` (or `kinet update --team` alone):

1. Symlink `agents/`, `commands/` and `skills/` into the project's `.claude/` — links, not copies, so edits in the team dir apply to every project immediately. Real files and foreign symlinks are never overwritten; stale links are removed.
2. Add a **Delivery Team** section to `CLAUDE.md` that `@`-imports the ways of working and `team-lead.md`.
3. Add the team dir's parent to `permissions.additionalDirectories` in `.claude/settings.json`, so sessions can update the team (e.g. an end-of-task retro).

If no team dir exists, this step is skipped and KINET behaves as before.

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
| `kinet_git_status` | Branch, upstream ahead/behind, staged/unstaged/untracked files and recent commits (read-only) |
| `kinet_git_diff` | Diff stat and patch for unstaged, staged or `ref...HEAD` changes, optionally for one path (read-only) |
| `kinet_find_todos` | List `TODO`/`FIXME`/`HACK`/`XXX` markers (uppercase, whole word) with file and line, flagging those without a ticket like `[PROJ-123]` |
| `kinet_run_script` | Run a script declared in `package.json` (test, lint, build) and return exit code and output. **Executes project code.** |
| `kinet_check_deps` | Outdated npm packages and `npm audit` vulnerability counts (read-only; `npm audit` sends the dependency tree to the npm registry) |

The five project tools need no `kinet init` and no extra configuration. They run `git`/`npm` without a shell, refuse arguments starting with `-` and paths outside the project, and cap their output at 20,000 characters. `kinet_find_todos` uses the same ticket rule as `kinet validate`, but it only lists uppercase markers, while `validate` also flags a lowercase `todo`. `kinet_run_script` and `kinet_check_deps` need an npm project and are not available on Windows yet.

The git tools honour the repository's own `.git/config` (for example `filter.<name>.clean` commands run during `git status`/`git diff`), exactly as plain `git` does. Kinet switches off `core.fsmonitor`, textconv and external diff drivers, but do not run these tools (or plain git) in a folder whose `.git` you don't trust.

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

## Contributing

```bash
npm install
npm run lint                # ESLint flat config (eslint.config.js)
npm test                    # node:test; finds every *.test.js under the repo
npm pack --dry-run          # tests and src/test-support are excluded from the package
```

---

## Licence

MIT
