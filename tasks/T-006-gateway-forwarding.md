---
id: T-006
title: "Gateway: authenticated request forwarding"
phase: 0
status: todo
tier: sonnet
depends_on: [T-002, T-004]
covers: [P3]
assignee: null
started: null
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
- [ ] AC-1: The forwarded request carries correct Basic auth; the response round-trips.
- [ ] AC-2: Client-supplied `authorization`, `cookie` and `proxy-authorization` headers are rejected.
- [ ] AC-3: `..`, absolute URLs and `/auth/connect/x` are rejected with `forbidden_path`.
- [ ] AC-4: Binary responses arrive as base64 and decode to the original bytes.
- [ ] AC-5: `set-cookie` never reaches the caller.
- [ ] AC-6: A 401 triggers the connection's re-authentication path.
- [ ] AC-7: A capturing logger proves no password, auth header or body content is logged.

## Verification
```bash
bun run check
```

## Stop and ask if
- A legitimate engine route the UI needs falls outside the allowlist.

## Result
_Filled in by the agent._
