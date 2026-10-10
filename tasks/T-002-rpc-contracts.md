---
id: T-002
title: RPC contracts and Channel v0
phase: 0
status: todo
tier: sonnet
depends_on: [T-001]
covers: [P3]
assignee: null
started: null
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
_Filled in by the agent._
