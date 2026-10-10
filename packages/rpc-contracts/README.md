# @mortise/rpc-contracts

Transport-neutral schemas for messages between the UI and the gateway.

- **Status:** Phase 0, task T-002
- **Entry point:** `src/index.ts`

## Responsibility
Zod schemas and TypeScript types for every gateway call and event, plus the `Channel` interface that MessagePort (desktop) and WebSocket (web, later) both implement. Both ends validate every message against these schemas.

## Allowed imports
- `zod`
- `@mortise/domain`

## Forbidden imports
- `@opencode/*`
- `react`
- `electron`
- Node or DOM APIs

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
