# ADR-0002: Join the shared service; never replace it unasked

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
One service per user; official clients replace other versions; two engines on one database are likely unsafe.

## Decision
Discover and join without a version pin. Start the service with the user's installed CLI only when none is running. Ship no engine binary. Restart only with consent. Isolated mode always uses its own database.

## Alternatives considered
Always spawn a private engine (OpenChamber). Pin and replace (the official desktop). Bundle a CLI.

## Consequences
You must support a version range and handle engines you did not choose. Sessions are shared with the TUI and the official app.
