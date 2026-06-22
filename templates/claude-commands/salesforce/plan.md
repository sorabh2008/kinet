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
What will and won't be built. Note any declarative-vs-code tradeoff (Flow/Process Builder vs Apex).

### Architecture
How this fits into the existing `force-app` structure — trigger → handler → service/selector layers, and any LWC components involved.

### Files to Create / Modify
A concrete list (Apex classes, triggers, LWC bundles, custom metadata/objects). No file should be listed unless it will actually change.

### Implementation Steps
Numbered, ordered by dependency. Each step should be small enough to complete in one Claude Code session.

### Governor Limit Considerations
Call out any risk of SOQL/DML-in-loop, CPU time, or callout limits and how the design avoids them.

### Tests
Apex test classes required (`@isTest`), target coverage, and any LWC Jest tests.

### KINET Rule Check
Flag any rules that this change touches.

Do not write any code yet — wait for approval.
