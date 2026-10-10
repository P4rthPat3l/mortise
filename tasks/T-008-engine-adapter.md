---
id: T-008
title: Engine adapter v0
phase: 0
status: ready
tier: sonnet
depends_on: [T-001, T-007]
covers: [P4]
assignee: null
started: null
---

# T-008 Engine adapter v0

## Goal
`@mortise/engine-opencode` turns OpenCode's API and event stream into Mortise domain types. It is the only code that knows OpenCode wire formats, and it works over any injected `fetch`, so the renderer can run it through the gateway.

## Read first
- `docs/opencode/engine-contract.md`: "Agent gotchas", sections 4, 5, 6, 13
- `docs/architecture/overview.md`: 6.7 Errors, events and reconnection; 6.9 contracts
- `packages/engine-opencode/README.md`, `packages/domain/src/`
- Fixtures from T-007 in `packages/engine-opencode/fixtures/`
- Upstream at v2.0.25: `packages/schema/src/session-event.ts`, `session-message.ts`, `identifier.ts`; generated client types in `@opencode/client` (`node_modules`)
- Reference only: OpenChamber's translation, https://github.com/openchamber/openchamber/blob/9ed7e7dddb02d350f26a73ac2e370ee6cb160c11/packages/ui/src/lib/opencode/events.ts

## Scope
In `packages/engine-opencode/src/`:
- `adapter.ts`: `createAdapter({ serverId, baseUrl, fetch })` builds `OpenCode.make({ baseUrl, fetch })` from the `@opencode/client` Promise root.
- `ids.ts`: `newMessageId()` producing `msg_` plus the same 26-character time-ordered format as upstream `Identifier.ascending()` (12 hex characters of `timestamp * 4096 + counter`, then 14 random base-62 characters). Ordering depends on it.
- `sessions.ts`: list, get, create, `prompt({ sessionId, text, clientMessageId })`, interrupt. `prompt` sends only fields the engine declares and always sends `id: clientMessageId`.
- `timeline.ts`: maps message pages to `TimelineItem[]`.
- `requests.ts`: pending permissions and forms, and answer functions for the user's own UI (`once | always | reject`; form answers).
- `events.ts`: `translate(wire: unknown): DomainEvent[]`. Covers session lifecycle, execution started/succeeded/failed/interrupted (session activity), step, text and reasoning deltas, tool input/called/progress/success/failed, permission and form events. Unknown event types return `[]` and increment a counter exposed for diagnostics. Malformed payloads return `[]` and are counted separately.
- `README.md`: a mapping table from wire event and endpoint to domain type.

## Out of scope
Holding credentials, choosing when to resync (the composition root does, T-012), capability detection (gateway, T-004).

## Acceptance criteria
- [ ] AC-1: Contract tests replay T-007 fixtures through a fake `fetch` and assert domain output for every recorded endpoint.
- [ ] AC-2: Replaying `events-turn.jsonl` through `translate` produces a timeline equal to mapping the final message list (snapshot and deltas agree). If T-007 produced no turn fixture, write the test against a hand-made fixture and note it.
- [ ] AC-3: `newMessageId()` values sort in creation order, including within one millisecond (test).
- [ ] AC-4: `prompt` with the same `clientMessageId` twice sends the same `id` (test the request body).
- [ ] AC-5: Unknown and malformed events are counted, never thrown.
- [ ] AC-6: Only the Promise root of `@opencode/client` is imported (`bun run check:deps`).

## Verification
```bash
bun run check
```

## Notes and gotchas
- T-001 built the timeline and form types before anyone mapped real wire data, and says so in its Result. You may make **additive** changes to `@mortise/domain` (new part kinds, new optional fields, new form field types) when a real wire concept needs a home. List each change in Result. Renaming or removing an existing domain type still needs the maintainer.
- The fixtures in `packages/engine-opencode/fixtures/2.0.26/` include a full deterministic turn (`events-turn.jsonl`, recorded with `scripts/fake-provider.ts`). They also contain location-initialization events and sandbox-local absolute paths; assert on shapes, not on paths or ids.
- There is no session status event. Derive activity from `session.execution.*` events (and the `/api/session/active` snapshot during resync).
- Text and reasoning deltas are ephemeral events without a `durable` envelope. Tool calls are keyed by call id.

## Stop and ask if
- A wire concept has no place in the domain model. Propose a domain change instead of leaking the wire type.

## Result
_Filled in by the agent._
