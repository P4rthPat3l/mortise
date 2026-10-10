# ADR-0004: Adapter package as the only OpenCode-aware code

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Wire shapes change across releases. Features and extensions must not change with them.

## Decision
`@mortise/engine-opencode` alone imports `@opencode/*`, maps to a client-owned domain model and exposes capability flags.

## Alternatives considered
Use generated types everywhere. Depend on `@opencode/client/solid` as the store.

## Consequences
A mapping layer to maintain. Engine upgrades touch one package.
