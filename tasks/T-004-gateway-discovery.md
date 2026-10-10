---
id: T-004
title: "Gateway: discovery and connection state machine"
phase: 0
status: todo
tier: sonnet
depends_on: [T-001, T-002, T-003]
covers: [P1]
assignee: null
started: null
---

# T-004 Gateway: discovery and connection state machine

## Goal
`@mortise/gateway-core` finds the user's OpenCode service, starts one only when allowed and none exists, checks version and capabilities, and exposes a `ConnectionState` stream. It never replaces or stops the shared service.

## Read first
- `docs/features/FEAT-001-engine-gateway.md` (from T-003): the rules you implement. Cite its IDs in test names.
- `docs/opencode/engine-contract.md`: "Agent gotchas", section 2, sections 13.2, 13.3, 13.6
- `packages/gateway-core/README.md`
- Upstream at v2.0.25: `packages/client/src/promise/service.ts`, `packages/client/src/service-probe.ts`, `packages/protocol/src/groups/server.ts`

## Scope
In `packages/gateway-core/src/`:
- `discovery.ts`: wraps `discover()` and `ensure()` from `@opencode/client/service` behind an injectable interface. `ensure()` is called only when policy allows starting, never with a `version` option, and uses the user's CLI (`["opencode", "serve", "--service"]`). Detects whether the CLI is installed through an injectable lookup.
- `probe.ts`: `GET /api/info` with Basic auth (username `opencode`), parsed with Zod. A 404 means incompatible protocol. Compares the version against the supported range with a small local comparison (no new dependency) and returns `SupportState`.
- `capabilities.ts`: derives `EngineCapabilities` from `/api/info` capabilities and `/openapi.json` operation ids, cached per version.
- `connection.ts`: the state machine from FEAT-001, emitting `ConnectionState` changes. Injectable clock, fetch, discovery and logger. Detects registration replacement (another client restarted the service) and returns to `discovering`.
- `gateway.ts`: `createGateway(options)` that owns one connection for the shared server in Phase 0 and exposes `servers()`, `connection(serverId)`, `onConnectionChange(handler)`, and internal access to credentials for T-005 and T-006. Credentials are never part of any value returned through the public API.

## Out of scope
Event streaming (T-005), request forwarding (T-006), Electron wiring (T-009), isolated and remote modes.

## Acceptance criteria
- [ ] AC-1: Unit tests cover every transition in FEAT-001's state diagram with injected fakes. No network.
- [ ] AC-2: A test asserts `ensure()` is never called with a `version` option, and never called when a registration exists.
- [ ] AC-3: Version 2.0.19 is `unsupported`, 2.0.20 to the tested maximum is `supported`, a newer 2.0.x is `untested`, 2.1.0 is `unsupported`.
- [ ] AC-4: 401 moves to `unauthorized`, re-reads the registration, and recovers when the password changed.
- [ ] AC-5: No public return value or log line contains the password (test with a capturing logger).
- [ ] AC-6: Imports respect the gateway-core rules (`bun run check:deps`).

## Verification
```bash
bun run check
```

## Notes and gotchas
- FEAT-001 section 28 "Answers" is binding: the gateway never emits `hydrating`; no restart offer in Phase 0; `no-engine` rechecks on focus, on Retry, and every 30 s.
- This machine exports `OPENCODE_CONFIG` (set by another OpenCode client) and other `OPENCODE_*` variables. When `ensure()` starts the **shared** service, pass the environment through unchanged: the shared service must behave exactly as if the user ran `opencode serve --service` themselves. Scrubbing the environment is only for isolated sandboxes (T-007 does that).
- `discover()` reads `service.json` and returns `{ url, auth }`. That file is the official discovery contract; read it only through the client library, never directly.
- The Node `fetch` is available in Node 24. Inject it so tests stay offline.

## Stop and ask if
- FEAT-001 is missing a rule you need, or conflicts with the upstream code.

## Result
_Filled in by the agent._
