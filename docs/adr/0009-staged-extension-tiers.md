# ADR-0009: Staged extension tiers

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Most customization needs no code, and code from strangers is the main risk.

## Decision
Declarative first, sandboxed iframes second, privileged services last. Agent capabilities go into OpenCode engine plugins.

## Alternatives considered
In-process plugins from the start.

## Consequences
Untrusted extensions cannot draw native UI inside the timeline at first.
