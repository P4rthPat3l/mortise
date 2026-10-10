# ADR-0003: Engine gateway in the Electron main process

- **Status:** Accepted (validate in Phase 0)
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Credentials must stay out of renderers. CORS refuses custom schemes. Several windows would multiply SSE subscriptions and the risk of overflow.

## Decision
Main owns discovery, credentials, one stream per server and request forwarding, with no domain logic. The logic lives in `@mortise/gateway-core`, which imports no Electron, so a Node server can host it for web and mobile.

## Alternatives considered
Renderer connects directly. A separate local server process from the start (OpenChamber).

## Consequences
One extra IPC hop per request. A little discipline now; no gateway rewrite when web and mobile arrive.
