# ADR-0014: Web and mobile reuse the desktop core

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Web and mobile follow the desktop. Rewriting UI or gateway per surface would double maintenance.

## Decision
One React UI and one gateway core. Web adds a server host with its own login. Mobile wraps the web build in Capacitor.

## Alternatives considered
React Native for mobile. Separate web product.

## Consequences
Mobile feels web-based rather than fully native. Extension sandboxing works the same everywhere.
