# Planning Skill

**Applies to:** React, Java/Spring, fullstack

When producing plans, follow this discipline to avoid over-engineering and ensure plans are executable.

## Planning Principles

1. **Scope before structure** — Agree what's in/out before deciding how to build it
2. **Fit the existing architecture** — New code should feel native, not like a foreign import
3. **One PR per logical change** — Large features decompose into mergeable slices
4. **Test-first thinking** — Define the test for each step before describing the implementation

## Plan Template

```
## Plan: <feature name>

### Scope
- IN: bullet list of what will be built
- OUT: explicit exclusions (prevents scope creep)

### Approach
2-3 sentences on the architectural approach and why it fits the existing system.

### Files

| File | Action | Reason |
|------|--------|--------|
| src/services/FooService.ts | create | new service layer |
| src/components/FooWidget.tsx | create | UI component |
| src/components/FooWidget.test.tsx | create | tests |
| src/pages/Dashboard.tsx | modify | add FooWidget |

### Steps (ordered by dependency)

1. **Step name** — Description. Tests: [what to test]
2. ...

### Risks & Open Questions
- List unknowns that could block or change the plan
- Call out external dependencies (API contracts, DB migrations)
```

## React-Specific Planning Checklist

- [ ] Are API calls going through `src/services/`?
- [ ] Is state at the right level (local / global)?
- [ ] Is routing handled via the existing router setup?
- [ ] Are new components in the correct directory?
- [ ] Is there an error boundary for new routes?
- [ ] TypeScript types defined before implementation?

## Java-Specific Planning Checklist

- [ ] Does the layering stay: Controller → Service → Repository?
- [ ] Are DTOs defined for all new API inputs/outputs?
- [ ] Is @Transactional at the service level?
- [ ] Are new entities mapped with MapStruct?
- [ ] Is the exception handled via existing @ControllerAdvice?
- [ ] Is a Liquibase/Flyway migration needed?

## Anti-Patterns to Flag

- Adding a new state management library without ADR
- Bypassing the service layer with direct repository calls from controllers
- Duplicating logic that already exists in another service
- Over-abstracting for a single use case (YAGNI)
- Underspecified "TBD" steps — every step must be concrete enough to implement
