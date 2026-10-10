# ADR-0005: Electron for the desktop shell

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Service discovery ships as Node code. Extensions need a consistent web platform. Upstream and OpenChamber both use Electron.

## Decision
Electron, with sandboxed renderers and `utilityProcess` available for later tiers.

## Alternatives considered
Tauri: smaller, but discovery would need porting or a sidecar, and system webviews differ across platforms.

## Consequences
Larger binaries and memory. One rendering engine for every extension author.
