# React Rules

**Applies to:** `.tsx`, `.jsx`, `.ts`, `.js` in React projects

## No Direct HTTP in Components
All API calls must go through `src/services/`. Components call services or custom hooks — never `fetch()` or `axios` directly.
**Why:** Mixing network logic into UI components makes them untestable and couples concerns.

## No Explicit `any` Type
Avoid `: any` in TypeScript. Use `unknown` and narrow with guards, or define a proper interface.
**Why:** `any` disables type checking and hides bugs that TypeScript was designed to catch.

## No Inline Styles
Use CSS modules, Tailwind classes, or styled components — not `style={{ ... }}` attributes.
Exceptions require `// kinet:allow` comment with justification.

## HTTP Calls via Service Layer Only
Keep `fetch`/`axios` calls in `src/services/`, not in components or pages.

## No Direct DOM Mutation
Never use `document.querySelector`, `getElementById`, or `innerHTML =` in React components.
Use `useRef` and React state instead.

## Keys in Lists
Every `Array.map()` rendering JSX must provide a stable, unique `key` prop.
Never use array index as key for a list that can be reordered or filtered.

## Services Not in Components
Components in `src/components/` and `src/pages/` must not contain direct HTTP calls.
Extract to `src/services/` or a custom hook in `src/hooks/`.

## Error Boundaries on Routes
Every new route/page must be wrapped in an ErrorBoundary.

## No console.log in Production Code
Use a proper logger. Remove `console.log`/`console.debug` before merging.
Add `// kinet:allow` to suppress the warning for intentional debug output in dev-only code.
