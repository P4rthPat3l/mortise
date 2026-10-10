# ADR-0007: First-party features as modules on an internal SDK

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Upstream proved the pattern at scale: a manifest, tokens, liveness, declared stores, and a host that never names a module.

## Decision
Every feature is a module with provides, uses and requires, contributing through registries and enforced by lint.

## Alternatives considered
Feature folders by convention (OpenChamber).

## Consequences
More ceremony per feature. Missing contribution points surface before the public API freezes.
