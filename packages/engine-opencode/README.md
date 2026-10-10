# @mortise/engine-opencode

Adapter that maps OpenCode wire formats to the Mortise domain model.

- **Status:** Phase 0, task T-008
- **Entry point:** `src/index.ts`

## Responsibility
The only package allowed to import `@opencode/*`. It builds a typed OpenCode client over an injected `fetch` (the gateway transport), maps requests and responses to domain types, translates wire events into domain events, and derives capability flags from the connected engine. It holds no credentials and renders nothing.

## Allowed imports
- `@opencode/client` (Promise root only)
- `@mortise/domain`

## Forbidden imports
- `@opencode/client/effect`
- `@opencode/client/solid`
- `@opencode/client/service`
- `react`
- `electron`
- Any `@mortise/*` package other than `@mortise/domain`

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
