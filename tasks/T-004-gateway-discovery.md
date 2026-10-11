---
id: T-004
title: "Gateway: discovery and connection state machine"
phase: 0
status: done
tier: sonnet
depends_on: [T-001, T-002, T-003]
covers: [P1]
assignee: deepseek-v4.1-flash
started: 2026-10-10
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
- `@mortise/rpc-contracts` (T-002) already defines the error codes `forbidden_path` and `engine_unreachable`, and `createServer` accepts a partial handler map, so register only what you implement.
- FEAT-001 section 11 is stale: it still lists `packages/domain` and `packages/rpc-contracts` as empty placeholders. Both are implemented. Fix those rows during your Mode D sync, along with the rows for what you build.
- FEAT-001 section 28 "Answers" is binding: the gateway never emits `hydrating`; no restart offer in Phase 0; `no-engine` rechecks on focus, on Retry, and every 30 s.
- This machine exports `OPENCODE_CONFIG` (set by another OpenCode client) and other `OPENCODE_*` variables. When `ensure()` starts the **shared** service, pass the environment through unchanged: the shared service must behave exactly as if the user ran `opencode serve --service` themselves. Scrubbing the environment is only for isolated sandboxes (T-007 does that).
- `discover()` reads `service.json` and returns `{ url, auth }`. That file is the official discovery contract; read it only through the client library, never directly.
- The Node `fetch` is available in Node 24. Inject it so tests stay offline.

## Stop and ask if
- FEAT-001 is missing a rule you need, or conflicts with the upstream code.

## Result

Implemented the T-004 scope in `packages/gateway-core/src/`:

- `discovery.ts` — wraps `discover()`/`ensure()` behind an injectable `ServiceClient`; owns the
  start policy (join a ready registration, start only when none exists and the CLI is found), never
  passes a `version`, and calls `ensure()` with `["opencode", "serve", "--service"]` so the user's
  own CLI starts the shared service. `defaultFindCli()` checks `PATH` and common install locations.
- `probe.ts` — `GET /api/info` with Basic auth, parsed with Zod; 404 is `info-missing` (incompatible
  protocol); a local version comparison returns `SupportState` (`2.0.20`..`2.0.26` supported, newer
  `2.0.x` untested, below the floor or `>=2.1.0` unsupported).
- `capabilities.ts` — derives `EngineCapabilities` from `/api/info` and `/openapi.json` operation
  ids, cached per version; a failed schema read degrades safely and is not cached.
- `connection.ts` — the state machine. Every §10 transition except `hydrating` (never emitted per
  Q-001). `no-engine` rechecks on focus/Retry and every 30 s; a 401 re-reads the registration and
  recovers when the password rotated; a below-floor service is not replaced.
- `gateway.ts` — `createGateway` composes the above for one shared server, exposes `servers()`,
  `connection(serverId)`, `onConnectionChange(handler)`, `retry`/`recheck`/`dispose`, and keeps
  credentials in `internal` for T-005/T-006, never through a public value.
- `logging.ts` — secret-free logger that redacts prohibited fields at every depth (SEC-002).

### Verification

- `bun run check` passes at `1d4669d`: Biome (infos only), `tsc --noEmit` in every package,
  `bun run check:deps` (93 modules, 0 violations), Vitest 155 passed / 2 skipped.
- Task Verification section is `bun run check`; only that command is listed, and it passes.
- Tests cite FEAT-001 rule IDs: `discovery.test.ts`, `probe.test.ts`, `capabilities.test.ts`,
  `connection.test.ts`, `gateway.test.ts`. Every AC in the task is covered: AC-1 (all transitions),
  AC-2 (ensure never called with a version, never when a registration exists), AC-3 (support states),
  AC-4 (401 recovery), AC-5 (capturing logger proves no secret in a public value or log line),
  AC-6 (`check:deps`).

### Not done / decisions

- The event-stream half of `onStreamConnected`/`onStreamLost` is exercised with direct calls; T-005
  wires a real stream into `gateway.internal.connection`. `gateway.internal` is the seam.
- The `hydrating` phase stays in `ConnectionState` for the per-window use T-012 owns; the gateway
  never emits it.
- Probe `unreachable`/non-404 errors map to `failed` (readiness failure). This is one transition
  beyond the literal §10 arrow set, justified by §16 "Spawn or readiness failure → failed with
  retry"; recorded here because it is an interpretation.
- `zod` was added to `gateway-core` (named by the task, "parsed with Zod"); README allowed imports
  updated.

### Mode D sync

FEAT-001 updated in the same branch (frontmatter, §1, §10 note, §11, §14, §15, §17, §19, §24, §30).
`implementation_status: in_progress`, `last_verified_commit: 1d4669d`, version `0.1.1`.

### Follow-ups

- T-005: subscribe the stream and call `onStreamConnected`/`onStreamLost`; emit `engine.resync`.
- T-006: call `connection.onUnauthorized()` on a forwarded 401.
- T-009: build `openCodeServiceClient()` + `defaultFindCli()` into a `createDiscovery`, then a
  `createGateway`, and register the `servers.list`/`connection.get` handlers.

Files: `packages/gateway-core/src/{discovery,probe,capabilities,connection,gateway,logging,index}.ts`
and their `*.test.ts`, `packages/gateway-core/package.json`, `packages/gateway-core/README.md`,
`bun.lock`, `docs/features/FEAT-001-engine-gateway.md`, this task file.
