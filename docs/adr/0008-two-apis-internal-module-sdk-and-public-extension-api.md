# ADR-0008: Two APIs: internal module SDK and public extension API

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
An API that serves both first-party and third-party code turns the whole app into a public contract.

## Decision
The internal SDK is unstable, in-process and framework-bound. The public API is versioned, async, serializable and capability-gated.

## Alternatives considered
One shared API, as in `gui-extensions` with `.ocdx`.

## Consequences
Two surfaces to document. Internals stay free to change.
