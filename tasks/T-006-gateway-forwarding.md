---
id: T-006
title: "Gateway: authenticated request forwarding"
phase: 0
status: review
tier: sonnet
depends_on: [T-002, T-004]
covers: [P3]
assignee: deepseek-v4.1-flash
started: 2026-10-11
---

# T-006 Gateway: authenticated request forwarding

## Goal
The gateway answers `engine.fetch` requests from the UI by forwarding them to the engine with authentication added, so renderer code can use the typed OpenCode client without ever holding a credential.

## Read first
- `docs/features/FEAT-001-engine-gateway.md`: forwarding and security rules
- `packages/rpc-contracts/src/methods.ts` (from T-002): the `engine.fetch` schema
- `docs/opencode/engine-contract.md`: section 3

## Scope
In `packages/gateway-core/src/forward.ts`:
- Validate the request again on the gateway side (defense in depth): path allowlist (`/api/` prefix or `/openapi.json`), no `..`, no absolute URL, no `/auth/` paths, no `authorization`, `cookie` or `proxy-authorization` headers.
- Add `Authorization: Basic` for user `opencode` with the current password, and forward to the server URL with a timeout.
- Response: status, headers without `set-cookie`, body as text for `text/*` and `application/json`, base64 otherwise.
- Map failures to channel errors: `engine_unreachable`, `timeout`, `forbidden_path`.
- On 401, notify the connection state machine (T-004) so it re-reads credentials.
- Export a handler that T-009 registers on the channel server.

## Out of scope
Channel transports, retries of non-idempotent requests (never retry them automatically).

## Acceptance criteria
Tests against a local Node `http` server:
- [x] AC-1: The forwarded request carries correct Basic auth; the response round-trips.
- [x] AC-2: Client-supplied `authorization`, `cookie` and `proxy-authorization` headers are rejected.
- [x] AC-3: `..`, absolute URLs and `/auth/connect/x` are rejected with `forbidden_path`.
- [x] AC-4: Binary responses arrive as base64 and decode to the original bytes.
- [x] AC-5: `set-cookie` never reaches the caller.
- [x] AC-6: A 401 triggers the connection's re-authentication path.
- [x] AC-7: A capturing logger proves no password, auth header or body content is logged.

## Verification
```bash
bun run check
```

## Stop and ask if
- A legitimate engine route the UI needs falls outside the allowlist.

## Result

**Changed:** `packages/gateway-core/src/forward.ts` (new) exports `createForwardHandler` — the
`engine.fetch` handler T-009 registers on the channel server — plus `ForwardDeps`,
`ForwardConnectionReporter` and `FORWARD_TIMEOUT_MS`; `index.ts` re-exports them. The handler
re-validates the path (`/api/` prefix or exactly `/openapi.json`; rejects `..`, a percent-encoded
traversal, absolute URLs and `/auth/*`) and the forbidden headers (`authorization`, `cookie`,
`proxy-authorization`, case-insensitive) before any network call, injects `Authorization: Basic`,
classifies the body as text for `text/*` and `application/json` and base64 otherwise, strips
`set-cookie`, maps failures to `forbidden_path` / `engine_unreachable` / `timeout`, and calls
`connection.onUnauthorized()` on a `401`. It forwards at most once, so a non-idempotent request is
never retried. `forward.test.ts` (10 tests) drives a local Node `http` server and cites the rule IDs.

**Decisions:**
- Basic auth is built with `basicAuthHeaders`, the same helper the probe and the event stream use,
  so the username is the discovered credential's (`opencode` in practice, per the engine contract).
- The timeout is a new gateway constant `FORWARD_TIMEOUT_MS` (30 s), added to FEAT-001 §22.
- Path validation also rejects percent-encoded traversal (`%2e`, `%2f`); an allowlisted `/api/`
  prefix would otherwise decode its way to `/auth/*`. `gateway.ts` is unchanged: T-009 wires
  `internal.endpoint()` and `internal.connection` into the handler.

**Verified:** `bun run check` passes at `508aaff` — Biome, `tsc --noEmit` in every package,
`check:deps` (no violations) and Vitest (202 passed, 2 skipped). Each rule has a named test: BR-019
and BR-020 (rejections, zero upstream requests), BR-021 (header equals `Basic base64("opencode:pw")`),
BR-022 (JSON/text round-trip, base64 decodes to the original bytes), BR-023/SEC-004 (`set-cookie`
absent), BR-024 (closed port → `engine_unreachable`; silent server → `timeout`), BR-025 (a `401`
fires `onUnauthorized` once and the response still round-trips), BR-026 (one upstream request for a
failing POST). SEC-002/AC-7 uses a capturing `createLogger` sink and asserts no password, auth
header value, or request/response body content appears across success, rejection and failure.

**Not done / follow-up:**
- `createServer` in `@mortise/rpc-contracts` answers a handler that throws `ChannelError` with
  `internal`, collapsing the code. A UI client never reaches the handler with a bad path or header,
  because the `engine.fetch` input schema rejects it first with `invalid_input` (AC-009's "or the
  input is rejected"), and nothing is forwarded either way, so the security property holds. But a
  caller that bypasses the schema would see `internal` instead of the reserved
  `forbidden_path`/`engine_unreachable`/`timeout`. Relaying a thrown `ChannelError`'s code belongs to
  `packages/rpc-contracts`, outside this task's named files; recommend T-009 or a follow-up fix. The
  envelope already reserves those codes for this handler.
- FEAT-001 is synchronized in Mode D (v0.1.4, `last_verified_commit: 508aaff`).
