---
id: T-005
title: "Gateway: event stream, batching and resync"
phase: 0
status: ready
tier: sonnet
depends_on: [T-004]
covers: [P2, P3]
assignee: null
started: null
---

# T-005 Gateway: event stream, batching and resync

## Goal
The gateway keeps exactly one `/api/event` subscription per connected server, survives stalls and disconnects, marks every reconnect with a resync, and fans batched raw events out to any number of subscribers (windows).

## Read first
- `docs/features/FEAT-001-engine-gateway.md`: event stream rules
- `docs/opencode/engine-contract.md`: section 4 and "Agent gotchas"
- Upstream at v2.0.25: `packages/server/src/handlers/event.ts`, `packages/server/src/event-feed.ts`, `packages/client/src/solid/connection.ts` (reference recovery constants)

## Scope
In `packages/gateway-core/src/events.ts` (and helpers):
- Open the stream with authenticated `fetch` and parse SSE frames, including comment lines (`: heartbeat`).
- The first event must be `server.connected`; anything else is an error that triggers reconnect.
- Idle watchdog: abort and reconnect after 45 s without any bytes. Heartbeats reset it.
- Reconnect with backoff (for example 1, 2, 5, 10 s, capped). Report state changes to the connection state machine (`live` ↔ `resyncing`).
- Each successful (re)connect increments `generation` and emits `engine.resync { serverId, generation, reason }` before forwarding any event of that generation.
- Forward events as `engine.events { serverId, generation, events }` in batches (default 16 ms window, configurable).
- Subscribers: `subscribe(serverId, handler) → unsubscribe`. Many subscribers share one upstream request.
- Do not interpret event payloads beyond JSON parsing and reading `type`. Translation belongs to the adapter.

## Out of scope
Request forwarding, Electron, event translation.

## Acceptance criteria
Tests use a local Node `http` SSE server fixture, no real engine:
- [ ] AC-1: Normal flow delivers events in order, batched.
- [ ] AC-2: Heartbeats keep a quiet stream alive past 45 s (use fake timers).
- [ ] AC-3: A stalled stream reconnects, increments `generation`, and emits `engine.resync` before new events.
- [ ] AC-4: A server-closed stream (simulating queue overflow) reconnects with resync.
- [ ] AC-5: A first event other than `server.connected` triggers reconnect and an error log.
- [ ] AC-6: Two subscribers produce one upstream connection (count requests at the fixture server).
- [ ] AC-7: Stopping the gateway closes the upstream and clears timers (no open handles).

## Verification
```bash
bun run check
```

## Notes and gotchas
- The stream has no replay. Correctness comes from the resync marker, which tells the UI to refetch.
- Malformed JSON in one event must not kill the stream: log it (without payload contents) and skip it.

## Stop and ask if
- You need a dependency for SSE parsing. The format is simple; write it.

## Result
_Filled in by the agent._
