# Java Rules

**Applies to:** `src/main/java/**/*.java`

## No Business Logic in Controllers
Controller methods must delegate immediately to a `@Service`.
Methods with >20 lines of logic indicate a violation.
**Why:** Keeps controllers thin, testable via `@WebMvcTest`, and logic reusable.

## DTOs Only in API Layer
Never use JPA `@Entity` classes as `@RequestBody` or `@ResponseBody` in controllers.
Map to/from DTOs using MapStruct.
**Why:** Exposes internal domain model, risks over-posting attacks, and couples API contract to DB schema.

## Constructor Injection Only
Never use `@Autowired` on fields. Use constructor injection — Lombok `@RequiredArgsConstructor` is preferred.
**Why:** Immutable dependencies, easier testing, detects circular dependencies at startup.

## No System.out in Production Code
Use SLF4J: `private static final Logger log = LoggerFactory.getLogger(Foo.class);`
Add `// kinet:allow` to suppress for approved cases.

## Transactions at Service Layer
`@Transactional` belongs on `@Service` methods, not on repositories.
**Why:** Transaction boundary should align with business operation boundary.

## Unchecked Exceptions in Services
Service methods must not declare checked exceptions in their signature.
Wrap with a `RuntimeException` subclass and handle via `@ControllerAdvice`.

## Optional Over Null
Service methods that may return no result must return `Optional<T>`, not `null`.
Controllers unwrap with `.orElseThrow()` for 404 responses.

## No Raw SQL Strings
All database queries via Spring Data JPA. If custom queries are needed, use JPQL with named parameters or Spring Data `@Query` with `:namedParam` — never string concatenation.
