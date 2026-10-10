# @mortise/domain

Client-owned domain model shared by every layer.

- **Status:** Phase 0, task T-001
- **Entry point:** `src/index.ts`

## Responsibility
Types and small pure helpers for servers, engine info and capabilities, sessions, timeline items, pending requests, connection states and domain events. It describes the client's view of the world and must stay independent of OpenCode wire formats so engine upgrades never ripple through the app.

## Allowed imports
- Nothing. This package has no imports.

## Forbidden imports
- `@opencode/*`
- `react`
- `electron`
- `zod`
- Any other `@mortise/*` package
- Node or DOM APIs

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
