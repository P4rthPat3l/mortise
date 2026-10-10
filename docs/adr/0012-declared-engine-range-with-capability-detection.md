# ADR-0012: Declared engine range with capability detection

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Daily engine releases. Strict request bodies. Additive changes since 2.0.10.

## Decision
Support `>=2.0.20 <2.1.0` at first, with an untested state for newer patches, flags from `/api/info` and `/openapi.json`, and a nightly matrix against the floor, the latest release and `v2` HEAD.

## Alternatives considered
Pin one exact version.

## Consequences
Some testing infrastructure to run. Users are not forced into upgrade lockstep.
