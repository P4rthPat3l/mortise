# ADR-0010: Client persistence in SQLite in main

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Upstream's desktop guidance prefers SQLite and cites Windows file-locking problems. Several windows share state.

## Decision
One client database with forward-only migrations and stores declared per module.

## Alternatives considered
JSON files, `localStorage`.

## Consequences
Every read crosses IPC, so stores load before modules read them.
