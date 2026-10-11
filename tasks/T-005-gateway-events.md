---
id: T-005
title: "Gateway: event stream, batching and resync"
phase: 0
status: review
tier: sonnet
depends_on: [T-004]
covers: [P2, P3]
assignee: deepseek-v4.1-flash
started: 2026-10-11
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
- [x] AC-1: Normal flow delivers events in order, batched.
- [x] AC-2: Heartbeats keep a quiet stream alive past 45 s (use fake timers).
- [x] AC-3: A stalled stream reconnects, increments `generation`, and emits `engine.resync` before new events.
- [x] AC-4: A server-closed stream (simulating queue overflow) reconnects with resync.
- [x] AC-5: A first event other than `server.connected` triggers reconnect and an error log.
- [x] AC-6: Two subscribers produce one upstream connection (count requests at the fixture server).
- [x] AC-7: Stopping the gateway closes the upstream and clears timers (no open handles).

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

**What changed**

- New `packages/gateway-core/src/events.ts`: `createEventStream` opens one authenticated
  `GET /api/event`, parses SSE frames (comments included), skips malformed JSON with a
  secret-free log, rejects a first event that is not `server.connected`, aborts a stalled stream
  after 45 s and reconnects with capped backoff (1, 2, 5, 10 s). It also bounds a stream that never
  starts with a 2 s connect timeout (OPS-005). Each successful connect increments `generation`; a
  reconnect emits `engine.resync` before any event of the new generation. Batches of raw events
  fan out on a 16 ms window (both configurable). `subscribe(handler)` shares the one upstream;
  subscribers are reference-counted, so the upstream stays open while one remains and closes with
  none (CASE-013). A stream `401` calls `connection.onUnauthorized`.
- `gateway.ts` creates the stream, starts it from `onServiceReady`, stops it on any terminal
  connection state, exposes it as `internal.events`, and disposes it in `gateway.dispose()`.
- `index.ts` exports the new symbols and constants.
- Tests: `events.test.ts` (13) plus one gateway-level 401 test in `gateway.test.ts`.

**Highest-risk behaviour pinned**

- Generation/resync ordering: `events.test.ts` test `BR-015 / AC-005` buffers a generation-1 event,
  stalls the stream mid-batch, then reconnects, and asserts no generation-1 event is delivered
  after the generation-2 resync. The implementation flushes a buffered batch before reporting the
  loss, so the old batch is always ahead of the next resync.
- `401` and reason vocabulary: `events.test.ts` `§16 / BR-011` asserts a 401 calls
  `onUnauthorized` and does not reconnect; `gateway.test.ts` `§16 / AC-004` asserts it reaches the
  connection machine through `gateway.internal.connection.onUnauthorized()`. Losses are reported
  through `onStreamLost("stalled" | "overflow" | "ended")` with the vocabulary already in
  `connection.ts`.

**Design decisions (not from the task text)**

- A server close is reported as loss `overflow` (resync `overflow`): the engine only closes a
  healthy SSE stream when it fails the subscriber, so this is the closest reason. A network error
  is `ended` (resync `reconnected`); a watchdog stall is `stalled` (resync `gap`).
- The upstream is subscriber-gated per CASE-013. The gateway sets the endpoint and marks the stream
  wanted, but no upstream request is made until a subscriber listens. T-009 windows subscribe; the
  connection reaches `live` then.

**Verification**

- `bun run check` (lint, typecheck, `check:deps`, all tests) passes: 192 passed, 2 skipped (the
  integration suites). The task's Verification section is only `bun run check`.
- New tests are all unit tests against a local Node `http` SSE fixture with an injected clock, so
  they need no engine, display or network beyond loopback.

**Left undone**

- AC-007's desktop-host half (two windows share one gateway) is T-009.
- Forwarding (T-006) is untouched.

**Follow-ups**

- T-009 must subscribe a window to `gateway.internal.events` for the upstream to open.
- T-013 exercises the event stream against a real isolated engine; a full resilience check of the
  buffered-batch ordering under a real overflow belongs there.

**Doc sync**

- FEAT-001 synced in Mode D: `events.ts` added to §11 as `Current` at `4323cc7`; BR-011..BR-017,
  AC-005..AC-007 and OPS-001/002/003/005/006 marked `Current`; §12 event and §22 configuration
  statuses corrected; §30 changelog and `last_verified_commit` updated.
