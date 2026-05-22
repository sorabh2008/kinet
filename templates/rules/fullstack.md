# Fullstack Rules

**Applies to:** fullstack projects (React + Java)

## API Contract First
Before implementing a new endpoint, define the request/response DTO and agree on the contract.
Use OpenAPI/Swagger annotations on the controller so the frontend team can generate a client.

## Shared Types via OpenAPI
Do not duplicate type definitions between frontend and backend.
Generate TypeScript types from the Spring OpenAPI spec: `npm run generate:api-types`.

## Cross-Origin: Explicit Allowlist
CORS must specify exact origins — no wildcard `*` in production Spring Security config.
Frontend dev server origin must be in the allowlist for local development only.

## Authentication: Single Source of Truth
Auth state lives in the backend. Frontend only stores the JWT/session token.
Never duplicate auth logic on the frontend.

## Error Response Shape
All API errors must return a consistent JSON shape:
\`\`\`json
{ "status": 400, "code": "VALIDATION_ERROR", "message": "...", "details": [...] }
\`\`\`
The React service layer must parse this shape and throw typed errors.
