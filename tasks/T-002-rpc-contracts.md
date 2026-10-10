---
id: T-002
title: RPC contracts and Channel v0
phase: 0
status: done
tier: sonnet
depends_on: [T-001]
covers: [P3]
assignee: deepseek-v4.1-flash
started: 2026-10-10
---

# T-002 RPC contracts and Channel v0

## Goal
`@mortise/rpc-contracts` defines every message between the UI and the gateway as a Zod schema, and a transport-neutral `Channel` that validates both directions. MessagePort (desktop, T-009) and WebSocket (web, later) will both plug into it.

## Read first
- `docs/architecture/overview.md`: 6.4 Communication mechanisms, 6.10 Path to web and mobile
- `packages/rpc-contracts/README.md`, `packages/domain/src/` (from T-001)

## Scope
Files in `packages/rpc-contracts/src/`, all re-exported from `index.ts`:

- `envelope.ts`: `Envelope` schema `{ v: 1, id, type: "request" | "response" | "event", name, payload?, error?: { code, message } }`.
- `schemas.ts`: Zod schemas mirroring the domain types the channel carries (`ServerRef`, `ConnectionState`, `EngineInfo`). Add a type-level test proving each `z.infer` type and its domain type are mutually assignable.
- `methods.ts`: request and response schemas for
  - `servers.list` → `ServerRef[]`
  - `connection.get` `{ serverId }` → `ConnectionState`
  - `engine.fetch` `{ serverId, method, path, query?, headers?, body }` → `{ status, headers, body }`. `method` is one of GET, POST, PUT, PATCH, DELETE. `path` must start with `/api/` or equal `/openapi.json`, and must not contain `..`. `headers` must not contain `authorization`, `cookie` or `proxy-authorization` (case-insensitive). `body` is `null | { kind: "text", text } | { kind: "base64", data }`.
- `events.ts`: event schemas `connection.changed { serverId, state }`, `engine.events { serverId, generation, events: unknown[] }` (raw wire events; the adapter validates them), `engine.resync { serverId, generation, reason }`.
- `channel.ts`:
  - `Transport { send(message: unknown): void; onMessage(handler): () => void; close(): void }`
  - `createClient(transport): Channel`, where `Channel` has `request(name, input, options?: { signal?, timeoutMs? })`, `subscribe(event, handler) → unsubscribe`, `close()`. Default timeout 30 s.
  - `createServer(transport, handlers)`: answers requests by name and can `emit(event, payload)`.
  - Both sides validate every inbound message. Error codes: `invalid_message`, `invalid_input`, `invalid_output`, `method_not_found`, `timeout`, `aborted`, `internal`.
- `memory.ts`: `createMemoryTransportPair()` for tests.

## Out of scope
MessagePort or WebSocket transports, gateway logic, engine payload validation.

## Acceptance criteria
- [ ] AC-1: Round trip of each method through a memory transport pair, with typed inputs and outputs.
- [ ] AC-2: Invalid inputs, unknown methods, timeouts and aborts each produce the right error code (tests).
- [ ] AC-3: `engine.fetch` rejects `authorization`, `cookie`, `proxy-authorization` headers and paths outside the allowlist (tests).
- [ ] AC-4: Unsubscribing stops delivery; `close()` rejects pending requests with `aborted`.
- [ ] AC-5: Imports only `zod` and `@mortise/domain`.

## Verification
```bash
bun run check
```

## Notes and gotchas
- Zod is pinned at 4.6.5. Use Zod 4 APIs.
- Keep generic helpers typed so `channel.request("engine.fetch", …)` infers input and output without casts.

## Stop and ask if
- A domain type cannot be mirrored without changing it. Coordinate a change to `@mortise/domain` rather than diverging.

## Result

**Changed:** `packages/rpc-contracts/src/` now implements the v0 channel, all re-exported from `index.ts`:

- `envelope.ts`: `Envelope` (`v`, `id`, `type`, `name`, `payload?`, `error?`) and the error-code enum.
- `schemas.ts`: Zod mirrors of `ServerRef`, `EngineCapabilities`, `EngineInfo`, `ConnectionState` and `ResyncReason`, plus a branded `serverIdSchema`.
- `methods.ts`: `servers.list`, `connection.get` and `engine.fetch`. `engine.fetch` enforces the path allowlist (`/api/` or `/openapi.json`, no `..`), rejects `authorization`/`cookie`/`proxy-authorization` case-insensitively, and carries the text/base64 body union.
- `events.ts`: `connection.changed`, `engine.events` (raw `unknown[]`), `engine.resync`.
- `channel.ts`: `Transport`, `AbortSignalLike`, `createClient`/`createServer`, `ChannelError`, the 30 s default timeout, abort and close handling, and both-direction validation.
- `memory.ts`: `createMemoryTransportPair()`.

Tests: `schemas.test.ts`, `methods.test.ts`, `channel.test.ts` (34 tests).

**Verified:** `bun run check` passes — Biome, `tsc --noEmit` in every package, `bun run check:deps` (no violations) and Vitest (34 passed, 2 skipped integration tests). Every acceptance criterion has a named test: AC-1 round-trips all three methods with inferred input/output types and a two-way `toExtend` proof that each schema output equals its domain type; AC-2 covers `invalid_input`, `method_not_found` (unknown method and missing handler), `timeout`, `aborted`, `invalid_output` and `invalid_message`; AC-3 covers the `engine.fetch` path allowlist, `..`, absolute URLs, `/auth/*` and the three forbidden headers; AC-4 covers unsubscribe and `close()` rejecting pending requests with `aborted`; AC-5 holds (`bun run check:deps`; imports are `zod` and `@mortise/domain` only).

**Decisions:**
- The envelope error codes include `forbidden_path` and `engine_unreachable` beyond the seven in the task, because FEAT-001 §12 and T-006 need them; this keeps T-006's forwarding boundary inside the existing contract.
- `rpc-contracts` compiles without the DOM or Node libs, so `channel.ts` declares the web-platform `setTimeout`/`clearTimeout` globals and exposes a structural `AbortSignalLike`. I probed that a DOM `AbortSignal` satisfies it, so T-009 can pass a real signal; no tsconfig change was needed.
- `servers.list` input is `z.void()`, so callers pass `undefined`.
- An untyped client request for a name outside `methods` is a programming error the typed API prevents; a request for an unknown method arriving over the wire is answered with `method_not_found`.

**Not done / follow-ups:**
- FEAT-001 is stale for this task: §11 still lists `packages/rpc-contracts/src/index.ts` as an empty placeholder, labels the contracts as Planned and still calls `@mortise/domain` an empty placeholder although T-001 is done. T-002 is not in the AGENTS.md feature-to-task map and I was scoped to this task and `packages/rpc-contracts/src/`, so I did not edit the feature document. The next FEAT-001 Mode D sync (T-004) should move the contracts Planned → Current and fix the domain row.
- `query` is typed `Record<string, string | string[]>`. T-012 should confirm that covers the generated client's query shapes.
- `createServer` takes `Partial<MethodHandlers>`, so T-006 and T-009 register only the handlers they implement.
