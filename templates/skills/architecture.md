# Architecture Skill

**Applies to:** React, Java/Spring, fullstack

Use this skill when reviewing or designing system structure, proposing refactors, or evaluating trade-offs.

## React Architecture Guidelines

### Component Hierarchy
```
pages/         ← route-level, owns data fetching
  ↓
components/    ← reusable, dumb — only know about their props
  ↓
hooks/         ← custom hooks encapsulate logic + state
  ↓
services/      ← all HTTP calls, no React dependencies
  ↓
store/         ← global state (only what truly must be global)
```

### Component Design Rules
- Single responsibility: one component does one thing
- Props down, events up — no prop drilling beyond 2 levels (use context or state)
- Composition over inheritance
- Controlled vs uncontrolled: pick one per component, document it
- Avoid memo/useMemo/useCallback until profiling proves it's needed

### Service Layer
- Services return typed data, not raw Response objects
- Services handle HTTP errors and throw typed Error subclasses
- No React hooks in services (they are plain functions)
- Services are mockable — used in tests without network

## Java Architecture Guidelines

### Layering Rules (strict — violations need ADR)
- Controller methods: ≤ 15 lines, delegate to service
- Services: own transactions, own business logic
- Repositories: data access only — no business rules
- No service-to-service calls that create circular dependencies

### Package Structure
```
com.company.project
├── api/           ← controllers and DTOs
│   ├── controller/
│   └── dto/
├── domain/        ← entities and value objects
├── service/       ← business logic
├── repository/    ← Spring Data repositories
├── infrastructure/ ← external integrations, config
└── security/      ← Spring Security config
```

### Design Patterns to Follow
- Repository pattern: Spring Data JPA (no raw EntityManager unless necessary)
- Mapper pattern: MapStruct for entity↔DTO conversion
- Strategy pattern: for switchable business logic (e.g. payment providers)
- Factory pattern: for complex entity construction
- Builder pattern: Lombok @Builder on DTOs/Entities

### What to Avoid
- Anemic domain model (entities with only getters/setters, all logic in service)
- Fat controllers
- God services (>500 lines — split by responsibility)
- Circular service dependencies (use events instead)
- Lazy loading in API responses (N+1 problem — use JOIN FETCH or projections)

## Cross-Cutting Concerns

| Concern | React approach | Java approach |
|---------|---------------|---------------|
| Logging | structured logger | SLF4J + MDC |
| Error handling | Error Boundary + service errors | @ControllerAdvice |
| Validation | react-hook-form + zod | Bean Validation |
| Auth | protected route wrapper | Spring Security filter chain |
| Caching | react-query cache | Spring Cache / Redis |
| Config | .env files | Spring profiles + externalized config |

## Architecture Decision Framework

When proposing a significant change, always provide:
1. **Problem**: what is this solving?
2. **Options considered**: at least 2 alternatives
3. **Decision**: chosen option with rationale
4. **Consequences**: what becomes easier, what becomes harder
5. **Add to ADR**: if accepted, add to `.kinet/prp/decisions.md`
