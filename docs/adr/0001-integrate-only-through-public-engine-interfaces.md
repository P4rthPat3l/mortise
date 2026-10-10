# ADR-0001: Integrate only through public engine interfaces

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
The engine changes fast, and an audited public HTTP contract exists. Engine storage and CLI files are internal, and OpenChamber shows the cost of depending on them.

## Decision
Use only the HTTP API, SSE, PTY sockets, plugin RPC, the registration file through `@opencode/client/service`, and published packages. No fork.

## Alternatives considered
Fork the engine. Embed the engine through `@opencode/sdk`. Read engine storage directly.

## Consequences
Some features wait for upstream. Upgrades stay cheap, and you never risk user data.
