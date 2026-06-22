# Node Rules

**Applies to:** `*.js`, `*.ts` in a Node.js backend (Express/Fastify/NestJS-style server)

## No require() In ESM Packages
If `package.json` declares `"type": "module"`, use `import`, never `require()`.
**Why:** Mixing CJS `require()` into an ESM package throws at runtime in most setups and signals an incomplete migration.

## No Synchronous Blocking Calls In Request Handlers
Never call `fs.readFileSync`, `fs.writeFileSync`, or `execSync` inside a route/controller/handler.
**Why:** Node has a single event loop — a sync call blocks every concurrent request for its duration.

## Async Handlers Must Handle Errors
Every `async (req, res) => {}` route handler needs a `try/catch` (or equivalent `.catch()`), or must run behind error-handling middleware.
**Why:** An unhandled rejection in a route handler can crash the process or leave the client hanging with no response.

## Database Access Through A Service/Repository Layer
Routes and controllers should not call the ORM/query builder directly.
**Why:** Keeps routes thin and testable, and centralizes data-access patterns (transactions, caching) in one place.

## Validate Environment Variables At Startup
Required `process.env.*` values should be validated once at boot (fail fast), not read ad-hoc and assumed present deep in request handling code.
