---
id: T-012
title: Workbench composition root and streaming timeline
phase: 0
status: ready
tier: sonnet
depends_on: [T-008, T-009, T-011]
covers: [P3, P4, P8]
assignee: null
started: null
---

# T-012 Workbench composition root and streaming timeline

## Goal
The desktop window lists sessions from the user's OpenCode service, shows one session's timeline with live streaming text, sends a prompt idempotently, and recovers correctly after a resync. Streaming re-renders only the parts that changed.

## Read first
- `docs/architecture/overview.md`: "Repository mapping", 6.5, 6.7, 6.11
- `docs/architecture/roadmap.md`: P3, P4, P8
- `packages/workbench/README.md`, `packages/workbench/src/modules/README.md`
- `packages/engine-opencode/README.md` (from T-008), `packages/sdk/src/` (from T-011)

## Scope
- `packages/workbench/src/bootstrap/`: the composition root. Build `gatewayFetch` on the channel's `engine.fetch` (encode and decode bodies), create the adapter, subscribe to `engine.events` and `engine.resync`, feed `translate()` output into a timeline store from `@mortise/core`, and run the resync procedure: refetch active sessions, pending requests, and the latest page of each visible session, then replace partial parts.
- Timeline store normalized by session, item and part id. Apply event batches once per animation frame.
- Modules in `src/modules/`: `sessions` (list), `timeline` (view), `composer` (prompt box using a client-generated message id; retry reuses it). They communicate through contracts only.
- `StreamingText` leaf component subscribed to one part (pattern in overview 6.11).
- Minimal base tokens in `packages/ui/src/tokens.css` (background, foreground, muted, accent, border, monospace and sans font stacks, spacing scale), with light and dark values, exported for the workbench to import. Plain styling with these tokens is enough.

## Out of scope
Permissions and forms UI, settings, theming, multiple servers.

## Acceptance criteria
- [ ] AC-1: Store and resync unit tests: applying a resync with fresh snapshots yields the same state as a fresh load (use T-007 fixtures).
- [ ] AC-2: Render-count test: streaming 2,000 text deltas into one part re-renders only that part's component; sibling parts and the session list do not re-render.
- [ ] AC-3: A retried prompt with the same client message id produces one user message (test with a fake channel).
- [ ] AC-4: `bun run check:deps` passes. Only `src/bootstrap/` imports the adapter; modules import peers only through `contract.ts`.
- [ ] AC-5: Manual: with OpenCode running, `bun run dev` lists real sessions and streams a reply. Record what you saw in Result (no screenshots of private content).

## Verification
```bash
bun run check
bun run build
```

## Notes and gotchas
- Fix from the wave 2 review: `packages/engine-opencode/src/events.ts` keeps its diagnostics counters in module-level state (`const counters`), which AGENTS.md forbids in UI code and which would mix counts across servers. Move the counters onto the adapter instance created by `createAdapter`, and drop `resetEventDiagnostics` in favor of creating a fresh adapter in tests.
- Open items handed over by T-002 and T-008: confirm `engine.fetch`'s `query` type (`Record<string, string | string[]>`) covers the generated client's query shapes, and decide whether `item.patched` and `part.patched` need more fields (for example message finish and cost) once the timeline store exists.
- Connecting to the user's shared service is allowed (ADR-002). Reading their sessions is fine; never delete or modify existing sessions in tests.
- A failed fetch must never render as an empty list.

## Stop and ask if
- Meeting AC-2 seems to require a state library. Ask before adding one.

## Result
_Filled in by the agent._
