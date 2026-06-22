---
description: Generate an implementation plan aligned to this project's stack and KINET rules
---

You are planning a feature for this project. Before writing any code:

1. Load KINET context via the `kinet_get_context` MCP tool
2. Load active rules via `kinet_get_rules`
3. Load the planning skill via `kinet_get_skill` with skill="planning"
4. Load PRP patterns via `kinet_get_prp` with section="patterns"

Then produce a plan with:

## Plan: $ARGUMENTS

### Scope
What will and won't be built.

### Architecture
How this fits into the existing routes/controllers → services → data-access layering.

### Files to Create / Modify
A concrete list. No file should be listed unless it will actually change.

### Implementation Steps
Numbered, ordered by dependency. Each step should be small enough to complete in one Claude Code session.

### Dependencies
Any new npm packages needed — check `package.json` first to avoid duplicating an existing dependency.

### Tests
What tests are required. Follow the project's testing conventions.

### KINET Rule Check
Flag any rules that this change touches.

Do not write any code yet — wait for approval.
