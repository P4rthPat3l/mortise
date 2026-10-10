# ADR-0006: React for the host UI; framework-neutral extension API

- **Status:** Accepted
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
Solid's advantages here were reuse of upstream's Solid packages and fine-grained updates for streaming. The first is small, because this design already avoids depending on `@opencode/client/solid` and treats `@opencode/ui` as optional. The second has known React solutions. The owner prefers React, and web and mobile are planned.

## Decision
React for first-party code. The public extension API exposes no framework types, so third-party authors can use anything inside their frames.

## Alternatives considered
Solid, closer to upstream's code and cheaper per streamed token.

## Consequences
Your own design system instead of `@opencode/ui`. Explicit module lifetimes and streaming patterns (6.6, 6.11). A larger contributor pool, OpenChamber's React code as nearby reference, and both Capacitor and React Native kept open for mobile.
