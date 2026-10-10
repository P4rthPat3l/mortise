---
id: T-008
title: Engine adapter v0
phase: 0
status: review
tier: sonnet
depends_on: [T-001, T-007]
covers: [P4]
assignee: deepseek-v4.1-flash
started: 2026-10-10
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
**Status:** review. FEAT-003 (`docs/features/FEAT-003-engine-adapter.md`) documents the feature; FEAT-002 was left for the module system as `docs/features/_index.md` and `AGENTS.md` reserve it, so this takes the next free id.

**Changed (adapter, `packages/engine-opencode/src/`):**
- `ids.ts`: `newMessageId(now?)` reproduces `Identifier.ascending()` — `msg_` + 12 hex chars of `timestamp * 4096 + counter` + 14 random base-62 chars — so ids sort in creation order.
- `adapter.ts`: `createAdapter({ serverId, baseUrl, fetch })` builds `OpenCode.make` over the injected fetch and binds the operations.
- `sessions.ts`: `listSessions`, `getSession`, `createSession`, `promptSession` (always `id: clientMessageId`), `interruptSession`, plus `toSessionSummary`.
- `timeline.ts`: `mapTimeline` maps a message page to a chronological `TimelineItem[]`; text/reasoning parts are keyed by `(messageID, ordinal)`, tool parts by call id.
- `requests.ts`: pending permissions and forms (runtime decoders used by both reads and events), the answer functions, and `listPendingRequests`.
- `events.ts`: `translate(wire)` plus `eventDiagnostics`/`resetEventDiagnostics`. Unknown types and malformed payloads are counted separately, never thrown.
- `index.ts` exports the above. `README.md` gained the endpoint/event mapping tables.
- Tests: `ids.test.ts`, `sessions.test.ts`, `timeline.test.ts`, `events.test.ts`, `requests.test.ts` (18 new tests).

**Domain changes (additive only, all in `packages/domain`):**
1. `timeline.ts`: `ToolCallPart` gained optional `metadata?: unknown` and `error?: string` (tool progress metadata and failure text had no home).
2. `timeline.ts`: new `ToolPartPatch` interface, re-exported from `index.ts`.
3. `timeline.ts`: `TimelinePatch` gained `item.patched` (the engine corrects a message's `time.created` on `session.inbox.delivered`) and `part.patched` (tool transitions arrive without the whole part, so a pure translator cannot resend it).
4. `requests.ts`: `FormQuestion.type` gained `"multiselect"` and `"external"`, and `FormQuestion` gained optional `url?: string`.
No existing domain type was renamed or removed.

**Why `item.patched`/`part.patched`:** a pure, stateless `translate` cannot rebuild a whole tool part (`session.tool.called`/`.success` carry no tool name) or a whole item on `session.inbox.delivered` (no text). The fixture replay proves the alternative — resending wholes — would drop fields.

**Verified:**
- `bun run check` — pass: lint, typecheck (all packages), `check:deps` (55 modules, no violations, AC-6), 23 tests passed, 2 integration tests skipped.
- AC-1: `sessions.test.ts` and `timeline.test.ts` replay `sessions-list.json`, `session-get.json`, `session-create.json` and `messages.json` through a fake `fetch` and assert the mapped domain values.
- AC-2: `events.test.ts` translates every line of `events-turn.jsonl`, reduces the `timeline.patch` events, and asserts deep equality with `mapTimeline(messages.json)`. Passes.
- AC-3: `ids.test.ts` proves ordering across and within one millisecond.
- AC-4: `sessions.test.ts` sends the same `clientMessageId` twice and asserts identical bodies containing only `id` and `text`.
- AC-5: `events.test.ts` asserts unknown and malformed inputs return `[]` and increment the separate counters.
- Never touched the real engine or its files; only committed fixtures are read.

**Not done / risks:**
- `info.json` and `openapi.json` are recorded but not replayed here: capability/version detection is the gateway's (T-004) and the task lists it out of scope.
- `translate` trusts the generated client's decoded types for reads (it validates events only). Read decoding is not runtime-validated beyond that.
- Non-`user`/`assistant` messages (shell, compaction, synthetic, skill, system, switch markers) are ignored, and several known events map to nothing; both are documented in FEAT-003.
- `packages/engine-opencode/tsconfig.json` still has `types: []`; the three fixture-reading tests carry a `/// <reference types="node" />` for `node:fs`, which keeps Node types out of the package's declared surface. The depcruise rule already permits Node in tests.

**Follow-ups:**
- T-012 decides whether `item.patched`/`part.patched` need more fields (e.g. message finish/cost) once the timeline store exists.
- T-014 can replay older-version fixtures through the same tests.

