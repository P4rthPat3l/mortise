# ADR-0011: Extensions never hold agent authority

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Any client holding the credential can approve agent actions, and a prompt can lead to shell execution.

## Decision
No API for permission replies, credentials or raw engine HTTP. `prompt:send` is critical and confirmed per use.

## Alternatives considered
Trust users to judge capabilities alone.

## Consequences
Some automation ideas need explicit user steps.
