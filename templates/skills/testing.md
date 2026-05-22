# Testing Skill

**Applies to:** React, Java/Spring, fullstack

## Testing Philosophy

- Test behaviour, not implementation
- Each test has one reason to fail
- Tests are the first consumer of your API — bad tests signal bad design
- No test is better than a misleading test

## React Testing

### Test Pyramid
```
E2E (Playwright/Cypress)     — critical user journeys (5-10%)
Integration (RTL)            — component + hooks together (30%)
Unit (vitest/jest)           — pure functions, hooks in isolation (60%)
```

### React Testing Library Rules
- Prefer `getByRole` > `getByLabelText` > `getByText` > `getByTestId`
- Never query by CSS class or component internals
- Use `userEvent` over `fireEvent` for interactions
- Wrap async operations: `await waitFor(...)` or `findBy...`

### What to Test in a Component
- Renders correctly for each prop variation
- User interactions trigger expected outcomes
- Loading / error / empty states
- Accessibility: labels, ARIA, keyboard navigation

### Hook Testing
- Use `renderHook` from `@testing-library/react`
- Test the hook's contract, not its internal state
- Mock at the service boundary, not inside the hook

### Mock Strategy
- Mock `src/services/` at the module boundary (vi.mock / jest.mock)
- Do NOT mock React hooks
- Do NOT mock sub-components (test composition)
- Use MSW (Mock Service Worker) for API mocks in integration tests

## Java Testing

### Test Pyramid
```
System / E2E                 — Postman / RestAssured (5%)
Integration (Spring context) — @SpringBootTest (20%)
Slice tests                  — @WebMvcTest, @DataJpaTest (25%)
Unit                         — plain JUnit5 + Mockito (50%)
```

### Unit Test Rules
- One test class per production class
- Method names: `should_<result>_when_<condition>()`
- Arrange / Act / Assert structure with blank line separators
- Mock at the class boundary (inject mocks via constructor)
- Never mock value objects or DTOs

### Slice Tests
- `@WebMvcTest` for controller layer: test HTTP, not business logic
- `@DataJpaTest` for repositories: use in-memory H2 or Testcontainers
- `@WebMvcTest` + MockMvc: test request/response serialization, validation, auth

### Integration Tests (Testcontainers)
- Extend a base class that starts containers once per suite
- Use `@Sql` scripts to seed test data
- Roll back after each test with `@Transactional`

### Test Data Builders
For complex entities, use the Builder pattern in test helpers:
```java
// UserTestBuilder.java in src/test/java
public class UserTestBuilder {
    public static User.UserBuilder defaults() {
        return User.builder().id(1L).email("test@example.com").role(Role.USER);
    }
}
```

## Coverage Expectations

| Layer | Target |
|-------|--------|
| Service (business logic) | ≥ 90% |
| Controller | ≥ 80% |
| Repository (custom queries) | ≥ 80% |
| React components | ≥ 70% |
| React hooks | ≥ 85% |
| Utility/helper functions | 100% |

## What NOT to Test
- Framework boilerplate (Spring auto-configuration, generated code)
- Trivial getters/setters (Lombok-generated)
- Third-party library internals
- Infrastructure configuration (test it by running)
