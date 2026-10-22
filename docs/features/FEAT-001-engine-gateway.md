---
doc_type: feature
feature_id: FEAT-001
title: Engine gateway
# status: proposed | approved | active | superseded | retired
status: proposed
# implementation_status: not_started | in_progress | shipped_unverified | shipped_verified | sunsetting
implementation_status: in_progress
owner: Mortise maintainers
created: 2026-10-10
last_updated: 2026-10-22
# Required before any claim in this document may be labeled Current.
last_verified_commit: 49d4309
# major: breaking contract/permission/storage change. minor: new behavior or rules. patch: corrections and verification.
version: 0.2.1
tags:
  - gateway
  - engine
  - discovery
  - event-stream
  - security
dependencies: []
related_features: []
---

# Engine gateway

> Finds the user's OpenCode service, joins it without ever replacing it, holds the engine credential, keeps one event stream per server, and forwards authenticated requests from the UI, so every other module can talk to the engine without knowing OpenCode or holding a secret.

## 1. Feature Snapshot

| Field                 | Details                                                                                             |
|-----------------------|-----------------------------------------------------------------------------------------------------|
| Document status       | Proposed — awaiting maintainer approval                                                             |
| Implementation status | In progress — T-004 (discovery, probe, capabilities, connection state machine), the T-005 event stream, the T-006 forwarding handler and the T-009 desktop host are implemented; AC-011 and SEC-005 pass with the credential-specific bundle check (§28 Q-007) |
| Owner                 | Mortise maintainers                                                                                  |
| Primary actors        | User, renderer window, gateway (main process), OpenCode service, other clients (official app, TUI)   |
| Trigger               | Application start; a window opening; a connection state change; a renderer request or subscription   |
| Outcome               | One authenticated connection to one OpenCode server, one shared event stream, forwarded requests     |
| Entry points          | `@mortise/gateway-core` (`src/index.ts`), hosted by `apps/desktop/src/main/gateway-host.ts`          |
| Data stores           | Engine server list in client SQLite; engine password in main memory now, OS keychain later           |
| External systems      | OpenCode v2 engine (`opencode serve --service`), registration file via `@opencode/client/service`    |
| Feature flag          | Not applicable                                                                                       |
| Last verified         | T-004 code read at `1d4669d`; the T-005 event stream read at `4323cc7`; T-006 forwarding read at `508aaff`; T-013 added the coexistence and resilience integration tests at `31b3238`; the T-009 desktop host read at `49d4309` |

### At a Glance

The user runs OpenCode independently. Mortise finds the running shared service, checks its version
and capabilities, and joins it. When none is running and the user's CLI is installed, Mortise starts
the shared service with that CLI; it never stops or replaces a running one. The gateway keeps a
single authenticated `/api/event` subscription per server and fans raw events out to every window,
marking each reconnect with a resync. Renderer code sends requests as `engine.fetch` messages; the
gateway adds Basic auth and forwards them, so the password never leaves the main process.

**Sections 1–23 and 30 describe planned behaviour. Section 24 is the phased implementation plan and
maps to tasks T-004, T-005, T-006 and T-009. Phase 1 (T-004: discovery, probe, capabilities and the
connection state machine) is implemented at `1d4669d`; Phase 2 (T-005: the event stream, batching and
resync) is implemented at `4323cc7`; Phase 3 (T-006: the forwarding handler) is implemented at
`508aaff`; Phase 4 (T-009: the desktop host and MessagePort channel) is implemented at `49d4309`.
The rows they own are labeled `Current`. AC-011 and SEC-005 pass with the credential-specific bundle
check recorded in §17 and §28 Q-007.

### Status Legend

Every `Status` value in this document is one of these four. They describe how much trust a statement
has earned, independent of the document and implementation statuses above.

- **Current**: implemented, and read in the code at `last_verified_commit`. Used for the T-004 rows
  (read at `1d4669d`), the T-005 event stream (read at `4323cc7`), the T-006 forwarding handler
  (read at `508aaff`) and the T-009 desktop host (read at `49d4309`).
- **Planned**: proposed or approved, but not implemented.
- **Inferred**: consistent with the evidence, but not directly verified against Mortise code.
- **Unknown**: unresolved. Tracked in §28.

A note on the label for engine facts: statements about OpenCode itself were read at OpenCode v2.0.25
and link to `../opencode/engine-contract.md` or to that tag's source. They are labeled `Inferred`
here — verified upstream, but not verified against any Mortise code path, which is the distinction
the axis-3 vocabulary makes.

## 2. Problem and Outcome

### Problem

An AI engine client has three problems the UI cannot solve on its own. The engine listens on HTTP
with Basic auth and refuses browser `Origin` headers it does not know, so a renderer cannot call it
directly. Every window would otherwise open its own SSE subscription, and the engine fails any
subscriber whose 4,096-event queue overflows, so multiple windows would multiply that failure. And
the engine password is a secret that must never reach renderer or extension code.

### Desired Outcome

One host-neutral gateway owns discovery, credentials, one event stream per server, and request
forwarding. It runs inside the Electron main process today and a Node server later. Renderers hold a
typed client over an IPC-backed `fetch` and never see a credential. Two windows share one upstream
stream. Every reconnect is reported as a resync so views rebuild from fresh reads rather than trusting
a lossy stream.

### Success Measures

| Measure                                  | Target                                       | How measured                                            |
|------------------------------------------|----------------------------------------------|---------------------------------------------------------|
| Upstream streams per connected server    | Exactly one, regardless of window count      | Fixture server request count (T-005 AC-6, T-009 AC-2)    |
| Credential markers in renderer build | Zero | No `Basic `, `info.password`, `opencode:` or `endpoint.auth` in `apps/desktop/out/renderer`; no `password`, `authorization` or `Basic ` in `out/preload` (T-009 AC-3) |
| Connection state after the official app restarts the service | Back to `discovering`, then joined again | Coexistence test (P1, T-013)                             |
| Timeline after a forced overflow vs a fresh load | Identical                              | Resilience test (P2, T-013)                              |

## 3. Scope

### Included

- Discovery of a running shared service through the registration file, only via `@opencode/client/service`.
- Start policy: start the shared service with the user's CLI only when none is registered and the CLI is installed.
- Version and capability detection against a declared supported range.
- The connection state machine and its transitions.
- One authenticated `/api/event` subscription per server, with idle watchdog, backoff, generation counter, batching and resync.
- `engine.fetch` request forwarding with a path allowlist, header rules, Basic auth injection and error mapping.
- Credential handling in the gateway only; secret-free logging.

### Excluded

- Event interpretation, status derivation, timeline projection and caching. These belong to the adapter (`@mortise/engine-opencode`) and the store (§BR-018).
- Isolated-engine mode and remote pairing. Deferred; a short note is in §26.
- Electron wiring and the MessagePort transport. They live in the desktop host and are described in §24 Phase 4; `@mortise/gateway-core` stays host-neutral.
- The engine's own agent loop, sessions, tools, permissions and persistence. The engine owns these.

### Assumptions

| ID      | Assumption                                                                 | Confidence | Validation needed                                                |
|---------|----------------------------------------------------------------------------|------------|-------------------------------------------------------------------|
| ASM-001 | The registration file is the complete discovery contract and is stable.    | High       | Upstream comment in `service.ts`; recheck on the nightly version matrix (T-014) |
| ASM-002 | `GET /api/info` stays the health and version probe.                        | High       | `service-probe.ts`; recheck against v2 HEAD (T-014)               |
| ASM-003 | The user's `opencode` CLI is on `PATH` or in a common install location.    | Medium     | Engine-discovery test with an injected lookup (T-004)            |
| ASM-004 | One shared service per user remains the norm.                              | High       | Overview A2; revisited if per-client engines become standard      |
| ASM-005 | The event stream never replays, so resync is the only correctness anchor.  | High       | `event-feed.ts`, `handlers/event.ts`; resilience test (T-013)     |

## 4. Terminology

| Term                | Meaning                                                                                          |
|---------------------|--------------------------------------------------------------------------------------------------|
| Engine              | The OpenCode v2 process (`opencode serve`), run by the user, reached over HTTP and SSE.          |
| Shared service      | The one background engine per user, registered in `service.json` and started with `serve --service`. |
| Registration file   | `$XDG_STATE_HOME/opencode/service.json` (fallback `~/.local/state/opencode/service.json`), the discovery contract. |
| Gateway             | This feature: the host-neutral engine gateway in `@mortise/gateway-core`.                        |
| Channel             | The transport-neutral typed connection between UI and gateway, defined by `@mortise/rpc-contracts`. |
| Generation          | A counter incremented on each successful stream connect; every event batch is tagged with it.    |
| Resync              | A `engine.resync` message telling views the stream was interrupted and their cached reads are stale. |
| Support state       | One of `supported`, `untested`, `unsupported`, computed from the engine version and the declared range. |
| Capability          | A boolean or set derived from `/api/info` and `/openapi.json`, describing what the engine offers. |

## 5. Actors and Permissions

| Actor             | Allowed actions                                             | Restrictions                                                     | Enforcement point                       |
|-------------------|-------------------------------------------------------------|------------------------------------------------------------------|-----------------------------------------|
| User              | Start the app, open windows, connect, consent to a restart  | Cannot force a replace without consent                           | Gateway start policy (§BR-003, §BR-004) |
| Renderer window   | Call `servers.list`, `connection.get`, `engine.fetch`; subscribe to events | Never receives the password, pairing token, or `set-cookie` | Channel method schemas (§12); T-006 forwarding |
| Gateway           | Read credentials, hold the stream, forward requests         | No domain logic, no Electron imports, no event interpretation    | `@mortise/gateway-core` dependency rules |
| OpenCode engine   | Serve HTTP and SSE, ask permissions                         | The gateway never writes its database or config                  | C1, C2 (§17)                            |
| Other clients     | Restart or replace the shared service on their own          | Mortise detects the change and returns to discovery              | §BR-010                                 |

## 6. User Journey

This is a system journey: the user's observable experience is a connection indicator and a working
window, not a sequence of screens.

### Primary Journey

1. The app starts; main shows a window skeleton and begins discovery in parallel.
2. Discovery reads the registration file through `@opencode/client/service`.
3. A ready, compatible registration is adopted; otherwise start policy decides whether to start one.
4. The gateway probes `GET /api/info`, computes the support state and capabilities.
5. The gateway opens one authenticated `GET /api/event`; the first event is `server.connected`.
6. The gateway reports `live` with capabilities; each window hydrates its visible state from fresh reads.
7. Renderer requests arrive as `engine.fetch`; the gateway adds Basic auth and forwards them.
8. On a stall, overflow or network loss, the gateway reconnects, bumps the generation, and emits `engine.resync` before new events.

### Alternate Journeys

| Journey                       | Trigger                                              | Expected outcome                                                        |
|-------------------------------|------------------------------------------------------|-------------------------------------------------------------------------|
| No engine, CLI installed      | No registration; `opencode` on `PATH`                | The gateway calls `ensure()` with no version; the user's CLI starts the service |
| No engine, no CLI             | No registration; CLI not found                        | `no-engine`; the client shows install options and rechecks on focus      |
| Running below the floor       | Registration version `< 2.0.20`                      | Not replaced; `incompatible`; read-only browsing where safe; update guidance |
| Newer patch, same minor       | Version `> highest tested`, `< 2.1.0`                | Join; report `untested`; keep missing capabilities off                   |
| Registration replaced         | Another client restarts the service                  | Back to `discovering`; recheck version; join again                       |
| Password rotated              | A forwarded request or the stream returns `401`      | Re-read the registration; recover if the password changed                |

## 7. System Context

The gateway sits between the renderer and the engine. Renderers never reach the engine directly; the
adapter never holds credentials. Other clients are peers, not subordinates.

```mermaid
flowchart LR
    Window["Renderer window: adapter over gateway fetch"] -- "MessagePort channel" --> Gateway["Gateway: discovery, credentials, stream, forwarding"]
    Gateway -- "HTTP + Basic auth" --> Engine["OpenCode service"]
    Gateway -- "GET /api/event, SSE" --> Engine
    Gateway -- "discover, ensure, stop" --> Reg["service.json via client/service"]
    Reg -. "written by" .-> Engine
    Other["Official app or TUI"] -- "may restart the shared service" --> Engine
    Gateway --> Store[("Client SQLite: server list")]
    Keychain[("OS keychain: secrets, later")] --> Gateway
```

The gateway is the only component in main that touches engine credentials. The adapter and the
workbench receive domain types and raw events, never wire credentials.

## 8. Control Flow

The gateway owns discovery, the start decision, and the connection lifecycle. Windows own hydration.
Forwarding decides path allowance.

```mermaid
flowchart TD
    A["Gateway starts"] --> B{"Registration found?"}
    B -- "yes, ready, compatible" --> D["Probe and open stream"]
    B -- "yes, version mismatch" --> V["Compute support state"]
    B -- "no" --> C{"CLI installed and start allowed?"}
    C -- "yes" --> E["ensure() with no version"]
    C -- "no" --> N["no-engine, show install options"]
    E --> D
    V --> D
    D --> F{"First event is server.connected?"}
    F -- "no" --> R["Reconnect with backoff"]
    F -- "yes" --> G["live: capabilities to windows"]
    G --> H["Forward engine.fetch with Basic auth"]
    H --> I{"Path allowed and headers clean?"}
    I -- "no" --> J["forbidden_path"]
    I -- "yes" --> K["Forward, map response and errors"]
    G --> R
    R --> D
```

| Step                    | Status  | Controlling component        | Decision                                        | Failure behavior                                      |
|-------------------------|---------|------------------------------|-------------------------------------------------|-------------------------------------------------------|
| Discovery               | Current | `discovery.ts`               | Whether a ready registration exists             | No registration falls through to start policy         |
| Start policy            | Current | `discovery.ts` + `connection.ts` | Start only if allowed and CLI installed     | `no-engine`; no spawn                                 |
| Support computation     | Current | `probe.ts` + `capabilities.ts` | Range check and capability set                | `incompatible` or `untested`; never a silent downgrade |
| Stream admission        | Current | `events.ts`                  | First event must be `server.connected`          | Reconnect and log an error                            |
| Forwarding authorization| Current | `forward.ts`                 | Path allowlist and header rules                 | `forbidden_path`                                      |
| Auth injection          | Current | `forward.ts`                 | Add Basic auth, strip `set-cookie`              | Map to `engine_unreachable` or `timeout`              |

## 9. Data Flow

### Startup

The gateway discovers, probes, opens the stream, then hands control to the windows for hydration.

```mermaid
sequenceDiagram
    participant M as Main
    participant G as Gateway
    participant S as client/service
    participant E as OpenCode service
    participant W as Window

    M->>G: create and start
    G->>S: discover()
    S-->>G: endpoint or undefined
    alt no ready service
        G->>S: ensure() with no version
        S->>E: opencode serve --service
        E-->>S: registration written
        S-->>G: endpoint
    end
    G->>E: GET /api/info (Basic auth)
    E-->>G: version, pid, capabilities
    G->>E: GET /openapi.json
    E-->>G: operation ids
    G->>G: compute support state and capabilities
    G->>E: GET /api/event
    E-->>G: server.connected
    G-->>W: live, capabilities, connection.changed
    W->>G: engine.fetch snapshots
    G->>E: forwarded with Basic auth
    E-->>G: snapshot bodies
    G-->>W: forwarded responses
```

### Resync

After any stream interruption the gateway reconnects, bumps the generation, and emits a resync
before forwarding new events. Windows refetch; they never replay deltas.

```mermaid
sequenceDiagram
    participant E as OpenCode service
    participant G as Gateway
    participant W as Window

    E-->>G: deltas and durable events
    G-->>W: engine.events, batched, generation N
    Note over G,E: overflow, 45 s stall, or network loss
    G->>G: generation N+1, state resyncing
    G->>E: GET /api/event
    E-->>G: server.connected
    G-->>W: engine.resync { generation: N+1, reason }
    W->>G: engine.fetch active sessions, pending requests
    G->>E: forwarded with Basic auth
    E-->>G: fresh snapshots
    G-->>W: responses, replacing stale cached reads
    E-->>G: new events
    G-->>W: engine.events, generation N+1
```

### Data Transformations

| Stage     | Status  | Input                          | Transformation                                             | Output                          |
|-----------|---------|--------------------------------|------------------------------------------------------------|---------------------------------|
| Discovery | Current | Registration file              | Read through `client/service`; classify state and version  | Endpoint plus service descriptor |
| Probe     | Current | `GET /api/info`, `/openapi.json` | Range compare, capability derivation, cache per version  | `EngineInfo` with support state |
| Stream    | Current | SSE frames                    | Frame parse, JSON parse for `type`, batch by interval      | `engine.events` batches         |
| Forward   | Current | `engine.fetch` message         | Validate, inject Basic auth, classify body, strip headers  | Forwarded response or channel error |

### Sensitive Data

| Data                | Classification | Storage                                        | Logging rule                              | Retention            |
|---------------------|----------------|------------------------------------------------|-------------------------------------------|----------------------|
| Engine password     | Restricted     | Main memory now; OS keychain later             | Prohibited — never logged                 | Service lifetime     |
| Pairing token       | Restricted     | Keychain (later)                               | Prohibited                                | Revoked on rotation  |
| `Authorization` header | Restricted  | Never stored                                   | Prohibited                                | Not stored           |
| Registration file   | Confidential   | Read-only through `client/service`             | Never logged verbatim                     | Not stored           |
| Request/response bodies | Confidential | In transit only                             | Content prohibited; size and status allowed | Not stored         |
| Server list         | Internal       | Client SQLite                                  | Allowed without secrets                   | Until removed        |

## 10. State Model

The connection state machine is the gateway's public state, exposed as `ConnectionState` over
`connection.get` and `connection.changed`. Every transition below matches
[overview 6.6](../architecture/overview.md).

```mermaid
stateDiagram-v2
    [*] --> Discovering
    Discovering --> Connecting: registration found
    Discovering --> Starting: none found and start allowed
    Discovering --> NoEngine: none found and start not allowed
    Starting --> Connecting: service ready
    Starting --> Failed: spawn or readiness failed
    Connecting --> Unauthorized: 401
    Connecting --> Incompatible: info 404 or version out of range
    Connecting --> Hydrating: server.connected
    Hydrating --> Live: snapshots loaded
    Live --> Resyncing: stream ended, stalled or overflowed
    Resyncing --> Hydrating: server.connected
    Resyncing --> Discovering: registration replaced
    Unauthorized --> Connecting: credentials refreshed
    Incompatible --> Discovering: user chose an action
    Failed --> Discovering: retry
```

| State        | Meaning                                             | Allowed transitions             | Side effects                                          |
|--------------|-----------------------------------------------------|---------------------------------|-------------------------------------------------------|
| `discovering`| Reading the registration and checking the CLI       | `connecting`, `starting`, `no-engine` | None                                             |
| `starting`   | `ensure()` is spawning the user's CLI               | `connecting`, `failed`          | Emits a start notice with the reason                  |
| `no-engine`  | No service and start not allowed                    | `discovering` (on focus, Retry or the 30 s timer) | Shows install guidance; never spawns                  |
| `connecting` | Probing `/api/info` and opening the stream          | `unauthorized`, `incompatible`, `hydrating` | None                                      |
| `unauthorized`| `401`; the password may have rotated               | `connecting` (credentials refreshed) | Re-reads the registration                        |
| `incompatible`| `/api/info` 404 or version outside the range        | `discovering` (user action)     | Shown with clear actions; may keep read-only browsing |
| `failed`     | Spawn or readiness failed                           | `discovering` (retry)           | Logs the failure without secrets                      |
| `hydrating`  | `server.connected` received; views refetch          | `live`                          | Emits `engine.resync` for the new generation          |
| `live`       | Stream connected and snapshots loaded               | `resyncing`                     | Batched `engine.events` fan out                       |
| `resyncing`  | Stream ended, stalled or overflowed                 | `hydrating`, `discovering`      | Marks cached reads stale; backoff reconnect           |

The gateway never emits `hydrating`: per Q-001 in §28, the gateway goes `connecting → live` once
`/api/info` succeeds and the event stream delivers `server.connected`, and `resyncing → live` after a
reconnect. `hydrating` is a per-window phase the workbench composition root (T-012) shows from the
moment it sees `live` or `engine.resync` until its snapshots load. `connection.ts` implements every
other transition at `1d4669d`; the event stream (`events.ts`, T-005) reports in through
`onStreamConnected` and `onStreamLost(reason)`, and reports a stream `401` through `onUnauthorized`.
The upstream only runs while a service is adopted and at least one subscriber is listening, so the
last window closing closes it without a state change (CASE-013). `gateway-host.ts` creates the
subscription that keeps a window live and removes it when that window closes (T-009, `49d4309`).

## 11. Implementation Map

### Existing Artifacts

Rows were read at the commit in the `Verified` column: the T-004 rows at `1d4669d`, the T-005 rows
at `4323cc7`, the T-006 rows at `508aaff`, and the T-009 rows at `49d4309`.

| Layer        | Responsibility                              | Repository path                             | Main symbol                                                        | Verified  |
|--------------|---------------------------------------------|---------------------------------------------|--------------------------------------------------------------------|-----------|
| Domain       | Client-owned model the gateway consumes     | `packages/domain/src/`                      | `ServerRef`, `ConnectionState`, `EngineInfo`, `EngineCapabilities` | `1d4669d` |
| Contracts    | Channel methods and events                  | `packages/rpc-contracts/src/`               | `methods`, `events`, `connectionStateSchema`                       | `1d4669d` |
| Discovery    | Wrap `discover`/`ensure`; start policy      | `packages/gateway-core/src/discovery.ts`    | `createDiscovery`, `openCodeServiceClient`, `defaultFindCli`       | `1d4669d` |
| Probe        | `/api/info` probe and support state         | `packages/gateway-core/src/probe.ts`        | `probeInfo`, `supportState`                                        | `1d4669d` |
| Capabilities | Capability derivation, cached per version   | `packages/gateway-core/src/capabilities.ts` | `deriveCapabilities`, `createCapabilityCache`                      | `1d4669d` |
| Connection   | Connection state machine                    | `packages/gateway-core/src/connection.ts`   | `createConnection`, `systemClock`                                  | `1d4669d` |
| Stream       | SSE parse, watchdog, backoff, batching, fan-out | `packages/gateway-core/src/events.ts`    | `createEventStream`, `EngineStreamEvent`, `StreamConnectionReporter` | `4323cc7` |
| Forward      | `engine.fetch` forwarding with auth and error mapping | `packages/gateway-core/src/forward.ts` | `createForwardHandler`, `ForwardDeps`                  | `508aaff` |
| Gateway      | Composition: servers, connection, stream, internals | `packages/gateway-core/src/gateway.ts` | `createGateway`                                               | `4323cc7` |
| Logging      | Secret-free logger with the prohibited rule | `packages/gateway-core/src/logging.ts`      | `createLogger`, `redactFields`                                     | `1d4669d` |
| Entry        | Public entry; JSDoc'd exports               | `packages/gateway-core/src/index.ts`        | —                                                                  | `508aaff` |
| Host         | Create the gateway once; wire per-window MessagePort channels | `apps/desktop/src/main/gateway-host.ts` | `createGatewayHost`                       | `49d4309` |
| Host         | `Transport` over `MessagePortMain`          | `apps/desktop/src/main/transport.ts`        | `mainTransport`                                                    | `49d4309` |
| Renderer     | `Transport` over the DOM `MessagePort`      | `apps/desktop/src/renderer/transport.ts`    | `rendererTransport`                                                | `49d4309` |
| Preload      | Forward the port to the main world          | `apps/desktop/src/preload/index.ts`         | —                                                                  | `49d4309` |
| Renderer     | Temporary debug view of the connection      | `packages/workbench/src/app.tsx`            | `App`                                                              | `49d4309` |

### Generated or Restricted Areas

| Path or area                                            | Classification | Rule                                                        |
|--------------------------------------------------------|----------------|-------------------------------------------------------------|
| `$XDG_STATE_HOME/opencode/service.json`                | Restricted     | Read only through `@opencode/client/service`; never edit it |
| `~/.local/state/opencode/`, `~/.config/opencode/`      | Restricted     | Never read or written (ADR-0002, C2)                        |
| `@opencode/*` imports                                  | Restricted     | Only `gateway-core` (`client/service`, types) and `engine-opencode` (`client`) |
| `.dependency-cruiser.cjs`                              | Restricted     | Do not weaken; changes need maintainer review                |
| Engine database and data directory                     | Restricted     | No import path may reach them (C2)                          |
| `apps/desktop/src/preload/`                            | Restricted     | Sandboxed CommonJS; security-sensitive                        |

## 12. Contracts

### Channel Envelope

All messages are defined in `@mortise/rpc-contracts` (T-002). Both ends validate every inbound
message. The gateway produces the three event payloads today (T-004 and T-005); the desktop host
(T-009) emits them over a channel. The `engine.fetch` handler exists (T-006, §BR-019..BR-026); the
`servers.list` and `connection.get` handlers are registered by the T-009 host at `49d4309`.

```json
{ "v": 1, "id": "msg_1", "type": "request", "name": "engine.fetch", "payload": {} }
```

`type` is `request`, `response` or `event`. Errors carry `{ "code": "...", "message": "..." }` with
one of `invalid_message`, `invalid_input`, `invalid_output`, `method_not_found`, `timeout`,
`aborted`, `internal`, plus the forwarding codes in §16. A handler that throws a `ChannelError` keeps
its code and message through `createServer`; the forwarding boundary relies on this for
`forbidden_path`, `engine_unreachable` and `timeout`. Any other handler error is answered with
`internal`.

### Requests (UI → Gateway)

| Method           | Input                                                                 | Output                | Status  |
|------------------|-----------------------------------------------------------------------|-----------------------|---------|
| `servers.list`   | none                                                                  | `ServerRef[]`         | Current |
| `connection.get` | `{ serverId }`                                                        | `ConnectionState`     | Current |
| `engine.fetch`   | `{ serverId, method, path, query?, headers?, body }`                  | `{ status, headers, body }` | Current |

`engine.fetch` constraints (from T-002): `method` is one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`;
`path` starts with `/api/` or equals `/openapi.json` and contains no `..`; `headers` must not contain
`authorization`, `cookie` or `proxy-authorization` (case-insensitive); `body` is
`null | { kind: "text", text } | { kind: "base64", data }`.

### Events (Gateway → UI)

| Event                | Payload                                        | Status  | Emitted when                                     |
|----------------------|------------------------------------------------|---------|--------------------------------------------------|
| `connection.changed` | `{ serverId, state }`                          | Current | Any connection state transition (T-004)          |
| `engine.events`      | `{ serverId, generation, events: unknown[] }`  | Current | Each batching interval while a generation is live (T-005) |
| `engine.resync`      | `{ serverId, generation, reason }`             | Current | Before forwarding any event of a new generation (T-005)  |

The payloads above are produced by `gateway.onConnectionChange` and `EventStream.subscribe` today;
the T-009 host subscribes each window's channel server to both and calls `createServer(...).emit`
(`gateway-host.ts` at `49d4309`). `engine.resync.reason` is `reconnected` for a network end, `gap`
for a stall and `overflow` for a server close. Raw wire events are `unknown[]`; the adapter
validates them. The gateway never interprets payloads beyond JSON parsing and reading `type`
(§BR-016).

### Engine HTTP Used

| Call                    | Purpose                                  | Status  | Source                                                        |
|-------------------------|------------------------------------------|---------|---------------------------------------------------------------|
| Registration `service.json` | Discovery                            | Inferred | [service.ts](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/client/src/promise/service.ts) |
| `GET /api/info`         | Version, pid, capabilities, health        | Inferred | [service-probe.ts](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/client/src/service-probe.ts) |
| `GET /openapi.json`     | Operation ids for capability derivation   | Inferred | `../opencode/engine-contract.md` §13.2                        |
| `GET /api/event`        | SSE stream                                | Inferred | [handlers/event.ts](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/server/src/handlers/event.ts) |
| `POST /api/pair` etc.   | Pairing and remote access (deferred)      | Unknown | `../opencode/engine-contract.md` §13.6                        |

## 13. Data Model and Storage

The gateway holds no engine-owned truth. Its only persistent data is the server list and connection
preferences in client SQLite; secrets move to the OS keychain in a later phase.

```mermaid
erDiagram
    SERVER {
        string id PK
        string kind
        string label
        string created_at
    }
    SECRET {
        string server_id FK
        string kind
    }
    SERVER ||--o| SECRET : "has, later in keychain"
```

| Store            | Status  | Purpose                              | Important fields                       |
|------------------|---------|--------------------------------------|----------------------------------------|
| Client SQLite    | Planned | Server list and connection preferences | `id`, `kind`, `label`                 |
| OS keychain      | Planned | Engine password and pairing tokens     | Deferred; `safeStorage` as the interim |

In Phase 0 the gateway models exactly one shared server; the table exists so the shape is stable when
remote servers arrive. Engine sessions, messages and configuration are engine-owned and are never
stored by the gateway (C2, §6.5 of the overview).

## 14. Business Rules

Rules BR-001..BR-010 and BR-018 are implemented and tested at `1d4669d` (T-004). BR-011..BR-017 are
implemented and tested at `4323cc7` (T-005). BR-019..BR-026 are implemented and tested at `508aaff`
(T-006). Every rule below is `Current`. Rule IDs are stable and are cited by test names.

| Rule ID | Status  | Rule                                                                                             | Enforcement point        | Test reference                          |
|---------|---------|--------------------------------------------------------------------------------------------------|--------------------------|-----------------------------------------|
| BR-001  | Current | Join a ready, compatible registration; never call `ensure()` while a registration exists         | `discovery.ts`           | `discovery.test.ts` (BR-001) |
| BR-002  | Current | `ensure()` is never called with a `version` option; the user's CLI starts the service            | `discovery.ts`           | `discovery.test.ts` (BR-002) |
| BR-003  | Current | Never stop, replace or reconfigure a running shared service except with explicit user consent    | `connection.ts`          | `connection.test.ts` (BR-003) |
| BR-004  | Current | Start only when no ready registration exists and the user's `opencode` CLI is found              | `discovery.ts`           | `discovery.test.ts` (BR-004) |
| BR-005  | Current | No service and no CLI yields `no-engine`; show install options and recheck on window focus, on Retry and every 30 s | `connection.ts`          | `connection.test.ts` (BR-005, CASE-010) |
| BR-006  | Current | Support is `supported` for `2.0.20`..highest tested, `untested` for newer `2.0.x`, `unsupported` below `2.0.20` or at/after `2.1.0` | `probe.ts` | `probe.test.ts` (BR-006) |
| BR-007  | Current | A running service below the floor is not replaced; Phase 0 shows the installed and required versions with no restart offer | `connection.ts` | `connection.test.ts` (BR-007, CASE-008/009) |
| BR-008  | Current | A 404 on `GET /api/info` is `incompatible` protocol, not an older version                        | `probe.ts`               | `probe.test.ts` (BR-008) |
| BR-009  | Current | Capabilities derive from `/api/info` and `/openapi.json` operation ids, cached per version       | `capabilities.ts`        | `capabilities.test.ts` (BR-009) |
| BR-010  | Current | A replaced registration returns the machine to `discovering` and rechecks the version            | `connection.ts`          | `connection.test.ts` (BR-010, CASE-006) |
| BR-011  | Current | Exactly one `/api/event` subscription per connected server, shared by all subscribers            | `events.ts`              | `events.test.ts` (BR-011, AC-007) |
| BR-012  | Current | The first stream event must be `server.connected`; anything else is an error that reconnects     | `events.ts`              | `events.test.ts` (BR-012, CASE-003) |
| BR-013  | Current | Abort and reconnect after 45 s with no bytes; heartbeat comments reset the deadline              | `events.ts`              | `events.test.ts` (BR-013, CASE-001/002) |
| BR-014  | Current | Reconnect uses capped backoff; a new successful connect resets it                                | `events.ts`              | `events.test.ts` (BR-014, CASE-014) |
| BR-015  | Current | Each successful connect increments `generation`; `engine.resync` precedes any event of that generation | `events.ts`         | `events.test.ts` (BR-015, AC-005) |
| BR-016  | Current | Forward events in batches on a configurable interval; never interpret payloads beyond JSON parse and `type` | `events.ts`    | `events.test.ts` (BR-016, AC-006) |
| BR-017  | Current | A malformed event is logged without payload contents and skipped; it never kills the stream       | `events.ts`              | `events.test.ts` (BR-017, CASE-005) |
| BR-018  | Current | The gateway holds no domain state and derives no status; every view is rebuildable from fresh reads | `gateway.ts`           | `gateway.test.ts` (BR-018) |
| BR-019  | Current | `engine.fetch` allows only `/api/*` and `/openapi.json`; rejects `..`, absolute URLs and `/auth/*` | `forward.ts`            | `forward.test.ts` (BR-019, AC-009, CASE-011) |
| BR-020  | Current | Reject client-supplied `authorization`, `cookie` and `proxy-authorization` headers, case-insensitive | `forward.ts`         | `forward.test.ts` (BR-020, AC-009) |
| BR-021  | Current | Inject `Authorization: Basic` with username `opencode` and the current password                   | `forward.ts`            | `forward.test.ts` (BR-021, AC-008) |
| BR-022  | Current | Response bodies are text for `text/*` and `application/json`, base64 otherwise                    | `forward.ts`            | `forward.test.ts` (BR-022, CASE-012) |
| BR-023  | Current | Strip `set-cookie` from forwarded responses                                                       | `forward.ts`            | `forward.test.ts` (BR-023, SEC-004) |
| BR-024  | Current | Forwarding failures map to `engine_unreachable`, `timeout` and `forbidden_path`                   | `forward.ts`            | `forward.test.ts` (BR-024) |
| BR-025  | Current | A `401` on a forwarded request notifies the connection machine to re-read credentials             | `forward.ts` + `connection.ts` | `forward.test.ts` (BR-025), `connection.test.ts` (BR-010) |
| BR-026  | Current | Non-idempotent requests are never retried automatically                                           | `forward.ts`            | `forward.test.ts` (BR-026) |

## 15. Acceptance Criteria and Cases

AC-001..AC-004 are implemented and tested at `1d4669d` (T-004). AC-005..AC-007 are implemented and
tested at `4323cc7` (T-005); the desktop-host half of AC-007 is covered by the T-009 tests. AC-008 and
AC-009 are implemented and tested at `508aaff` (T-006). AC-010 and AC-011 are implemented and tested
at `49d4309` (T-009); AC-011 uses the credential-specific check recorded in §28 Q-007.

### AC-001: Join an existing service — Status: **Current**

**Given** a ready, compatible registration
**When** the gateway starts
**Then** discovery adopts it and `ensure()` is never called
**And** the state reaches `connecting` without spawning a process

Test: `discovery.test.ts` (BR-001) and `connection.test.ts` (BR-001, BR-003): the fake service client
records that `ensure()` is never called on the `found` path, and the machine emits
`discovering → connecting`.

### AC-002: Version and capability detection — Status: **Current**

**Given** `GET /api/info` answers with a version and capabilities
**When** the probe runs
**Then** `2.0.19` is `unsupported`, `2.0.20`..highest tested is `supported`, a newer `2.0.x` is `untested`, and `2.1.0` is `unsupported`
**And** capabilities are cached per version

Test: `probe.test.ts` (BR-006, BR-008) and `capabilities.test.ts` (BR-009). Capabilities are derived
from the recorded 2.0.20 and 2.0.26 fixtures, and the cache issues one `/openapi.json` read per
version.

### AC-003: Start policy — Status: **Current**

**Given** no registration and an installed `opencode` CLI
**When** the gateway decides to start
**Then** it calls `ensure()` with no `version` option and the user's CLI command
**And** when no CLI is found it enters `no-engine` and spawns nothing

Test: `discovery.test.ts` (BR-002, BR-004) and `connection.test.ts` (BR-005, CASE-010). The captured
`ensure()` options carry `command: ["opencode", "serve", "--service"]` and no `version` key.

### AC-004: Unauthorized recovery — Status: **Current**

**Given** a probe or forwarded request returns `401`
**When** the password has rotated and the registration was rewritten
**Then** the state moves to `unauthorized`, the registration is re-read, and the state recovers

Test: `connection.test.ts` (BR-010, CASE-007) for the recovery path; `forward.test.ts` (BR-025) for
the forwarding half: a `401` response is returned to the caller and the connection machine's
`onUnauthorized` runs.

### AC-005: Resync on reconnect — Status: **Current**

**Given** a live stream
**When** it stalls for 45 s, overflows, or the connection drops
**Then** the gateway reconnects, increments `generation`, and emits `engine.resync` before any event of the new generation

Test: `events.test.ts` (BR-013, BR-015): a 45 s silence reconnects as `stalled` with a `gap` resync; a
server close reconnects as `overflow` with an `overflow` resync; a dedicated case stalls the stream
mid-batch and asserts no generation-N event is delivered after the generation-N+1 resync.
`coexistence.integration.test.ts` (T-013) drops a real engine's stream mid-turn and asserts the
`engine.resync` of generation 2 arrives before the gateway returns to `live`; `resync.integration.test.ts`
(T-013) proves the rebuilt adapter timeline equals a fresh load after a dropped stream and after a restart.

### AC-006: Ordered batched delivery — Status: **Current**

**Given** a healthy stream
**When** events arrive
**Then** they are delivered in order as `engine.events` batches on the configured interval, and malformed events are skipped with a secret-free log

Test: `events.test.ts` (BR-016, BR-017): two events arrive in one batch in order; a malformed payload
is skipped, logged without its contents, and the next valid event still arrives.

### AC-007: One upstream stream for many subscribers — Status: **Current**

**Given** two or more subscribers
**When** they subscribe to the same server
**Then** the fixture server sees exactly one upstream `GET /api/event`
**And** stopping the gateway closes the upstream and clears timers

Test: `events.test.ts` (BR-011, CASE-013): two subscribers receive the same batch while the fixture
counts one request; the upstream stays open while a subscriber remains, closes with none, and a stop
clears every timer. `gateway-host.test.ts` (T-009) attaches two windows to one fake gateway and
proves each channel server holds one subscription, which is removed when its window closes.

### AC-008: Authenticated forwarding — Status: **Current**

**Given** an `engine.fetch` request with an allowed path
**When** the gateway forwards it
**Then** the request carries correct Basic auth, the response round-trips, binary bodies arrive as base64, and `set-cookie` is absent

Test: `forward.test.ts` (BR-019, BR-021, BR-022, BR-023): a local Node `http` server records the
`Authorization: Basic` header for username `opencode`; an `application/json` and a `text/plain`
response round-trip as text; an `application/octet-stream` response arrives as base64 that decodes to
the original bytes; a response with two `set-cookie` headers exposes neither.

### AC-009: Forwarding boundaries — Status: **Current**

**Given** an `engine.fetch` request
**When** the path is outside the allowlist or a forbidden header is supplied
**Then** the request is rejected with `forbidden_path` (or the input is rejected) and never forwarded

Test: `forward.test.ts` (BR-019, BR-020, BR-024): `..`, a percent-encoded traversal, an absolute URL,
`/auth/connect/abc` and the three forbidden headers are each rejected with `forbidden_path`, and the
fixture server sees zero requests. The channel's `engine.fetch` input schema rejects the same inputs
with `invalid_input` before the handler is reached (`methods.test.ts`, T-002).

### AC-010: Desktop host and two windows — Status: **Current**

**Given** the app is ready with two windows
**When** both connect
**Then** they share one gateway and one event subscription per server, and each has a private channel

Test: `apps/desktop/src/main/gateway-host.test.ts` (AC-2): a fake gateway is created and started
once; two windows attach, each gets a private channel, and each channel server holds exactly one
stream subscription and one connection subscription. Both clients answer `servers.list` through the
same gateway. Closing a window releases only its subscriptions; `dispose` closes the channels and
disposes the gateway. `transport.test.ts` in `apps/desktop/src/main/` and
`apps/desktop/src/renderer/` runs both transports over worker-thread `MessageChannel`s.

### AC-011: No credential in the renderer — Status: **Current**

**Given** a production build
**When** the renderer and preload bundles are searched
**Then** no credential-handling code is present, and window security flags are unchanged

Test: The T-009 build was searched at `49d4309` with the credential-specific check from §28 Q-007.
The preload has no `password`, `authorization` or `Basic `. The renderer has no `Basic `,
`info.password`, `opencode:` or `endpoint.auth`. Its four `password` and `authorization` matches are
`@mortise/rpc-contracts`' `FORBIDDEN_HEADERS` and header-validation message, and React DOM's
`password: true` and `elem.type === "password"` branch; none of them handles a credential. The window
flags are unchanged (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`).

### Edge Cases

| Case ID  | Scenario                                            | Expected behaviour                                              | Test type            |
|----------|-----------------------------------------------------|-----------------------------------------------------------------|----------------------|
| CASE-001 | Stream silent for 45 s, then a heartbeat            | Watchdog stays satisfied; no reconnect                           | Unit (fake timers)   |
| CASE-002 | Stream silent for 45 s with no heartbeat            | Abort and reconnect; generation increments                       | Unit (fake timers)   |
| CASE-003 | First event is not `server.connected`               | Reconnect and log an error without payload contents              | Unit                 |
| CASE-004 | Event queue overflow closes the stream              | Reconnect with resync                                            | Unit                 |
| CASE-005 | Malformed JSON in one event                         | Skip and log; stream continues                                   | Unit                 |
| CASE-006 | Registration replaced while live                    | Move to `discovering`, recheck, rejoin                           | Integration (`coexistence.integration.test.ts`)  |
| CASE-007 | Password rotated; next request returns `401`        | Re-read registration; recover if the password changed            | Unit                 |
| CASE-008 | Version `2.0.19` running                            | `incompatible`; not replaced; update guidance offered            | Unit                 |
| CASE-009 | Version `2.1.0` running                             | `unsupported`; not joined as supported; clear actions            | Unit                 |
| CASE-010 | No CLI installed                                    | `no-engine`; no spawn; install options shown                     | Unit                 |
| CASE-011 | Path `/auth/connect/x` or `../api`                  | Rejected with `forbidden_path`; never forwarded                  | Unit                 |
| CASE-012 | Binary response body                                | Base64 round-trips to the original bytes                         | Unit                 |
| CASE-013 | Two windows close while stream is live              | Upstream stays open while one subscriber remains; closes with none | Unit              |
| CASE-014 | Reconnect storm after repeated instant failures     | Backoff sequence respected; no tight loop                        | Unit (fake timers)   |

## 16. Error and Recovery Behavior

| Failure                          | Surface behavior                        | Gateway behavior                                       | Recovery                                    |
|----------------------------------|-----------------------------------------|--------------------------------------------------------|---------------------------------------------|
| Stream stalled or overflowed     | Views marked stale; resync shown         | Reconnect with backoff; new generation; `engine.resync` | Automatic; views refetch                     |
| Network loss                     | Connection indicator changes             | Reconnect with backoff                                 | Automatic                                    |
| `401` on the stream or a forward  | Authentication prompt where needed       | Re-read registration; move to `unauthorized`           | Recover when credentials refresh             |
| `/api/info` 404                  | Incompatible state with actions          | No replace; surface the error                          | User updates the engine or restarts it       |
| Version out of range             | Incompatible state with actions          | No replace; may keep read-only browsing where safe     | Consented restart or engine update           |
| Spawn or readiness failure        | `failed` with retry                      | Log without secrets; no tight loop                     | Retry returns to `discovering`               |
| Engine unreachable on forward     | `engine_unreachable` channel error       | Fail the call; never retry non-idempotent calls        | Adapter/user decides                         |
| Forward timeout                   | `timeout` channel error                  | Fail the call                                          | Caller retries only if idempotent            |
| Malformed event                   | No user-visible change                   | Skip; log type only                                    | None needed                                  |

The gateway fails closed on forwarding: an invalid path or header is rejected before any network call
(§BR-019, §BR-020). It also fails closed on secrets: a log line that would contain a credential is
never emitted (§17).

## 17. Security and Privacy

| ID      | Requirement                                                                 | Enforcement                                  | Validation                                          |
|---------|------------------------------------------------------------------------------|----------------------------------------------|-----------------------------------------------------|
| SEC-001 | The engine password and pairing tokens never cross the channel               | Gateway holds them; channel schemas cannot carry them | Current: `gateway.test.ts` (AC-5) asserts every public value is password-free while `internal.endpoint()` still carries it |
| SEC-002 | No password, auth header, pairing token or body content appears in logs      | Secret-free logger with a prohibited-field rule | Current: `connection.test.ts` (SEC-002) and `forward.test.ts` (SEC-002, AC-7) with a capturing logger |
| SEC-003 | The gateway re-validates the path allowlist and header rules                 | `forward.ts`, defense in depth               | Current: `forward.test.ts` (SEC-003, BR-019, BR-020) |
| SEC-004 | `set-cookie` is stripped from forwarded responses                            | `forward.ts`                                 | Current: `forward.test.ts` (SEC-004, BR-023)        |
| SEC-005 | Renderer and preload bundles contain no credential handling                  | Bundle assertion                             | Current: at `49d4309` the preload has no `password`, `authorization` or `Basic `; the renderer has no `Basic `, `info.password`, `opencode:` or `endpoint.auth` (§28 Q-007) |
| SEC-006 | The gateway never touches the engine database, data directory or CLI-private files | Only `@opencode/client/service` reads the registration file | Current: `bun run check:deps` passes; the registration is read only through `@opencode/client/service` in `discovery.ts` |

Extensions are out of scope for this feature, but the design keeps ADR-0011 true: nothing in the
channel exposes credentials or lets a caller answer permission requests. The gateway forwards
permission replies like any other request; it never decides them.

## 19. Observability

Only logs are defined here. No metric names or latency targets are invented; monitoring needs are
Unknown (§28, Q-002).

### Logs

| Event                          | Level | Required fields                       | Prohibited fields                                  |
|--------------------------------|-------|---------------------------------------|----------------------------------------------------|
| Connection state change        | Info  | `serverId`, from-state, to-state      | Password, pairing token, registration contents     |
| Start decision                 | Info  | reason (`missing`/`version-mismatch`) | Credentials                                        |
| Stream connected / disconnected| Info  | `attempt`, error message (no secrets) | Payload contents                                   |
| Resync                         | Info  | `serverId`, `generation`, reason      | Payload contents                                   |
| Malformed event                | Warn  | event `type` when available           | Payload contents                                   |
| Forwarding failure             | Warn  | path, status or code                  | `Authorization`, body content, `set-cookie`        |

The logger takes a prohibited-field rule so SEC-002 is testable with a capturing logger rather than
by inspection.

T-004 implements the connection-state-change and start-decision lines, plus `registration replaced`
and the probe/start failure lines. T-005 adds the stream connected/lost, resync and malformed-event
lines. T-006 adds the forwarding path/header rejection, unreachable, timeout and `401` lines; none
carries a credential or a body. `logging.ts` redacts prohibited fields at every depth before a sink
sees them.

## 20. Testing Strategy

Tests run with Vitest, next to the code. Unit tests use injected `fetch`, clock, discovery and
logger — no network, no display, no real engine. Integration tests that need an isolated engine are
named `*.integration.test.ts` and are wrapped in `describe.skipIf(!process.env.MORTISE_INTEGRATION)`.

| Test type   | Coverage                                              | Path                                                |
|-------------|-------------------------------------------------------|-----------------------------------------------------|
| Unit        | Discovery, start policy, probe, capabilities, state machine, stream, forwarding | `packages/gateway-core/src/*.test.ts` |
| Unit        | Desktop host and both transports                      | `apps/desktop/src/main/gateway-host.test.ts`, `apps/desktop/src/main/transport.test.ts`, `apps/desktop/src/renderer/transport.test.ts` |
| Integration | Coexistence: join without replacing, survive a replacement, read-only check of the shared service | `packages/gateway-core/src/coexistence.integration.test.ts` (T-013) |
| Integration | Resync: a dropped stream and an engine restart rebuild the same timeline | `packages/engine-opencode/src/resync.integration.test.ts` (T-013) |

The integration files are skipped unless `MORTISE_INTEGRATION=1`; the shared-service test additionally needs `MORTISE_SHARED_SERVICE_TEST=1`. They start engines with `startSandbox` from `scripts/engine-sandbox.ts`, which grew `--service` (a temporary registration plus a real replacement), tree reuse for a restart, and `dispose()` (T-013). No single package may import both `gateway-core` and `engine-opencode`, so the resync suite is split: `gateway-core` proves the resync marker against a real engine and `engine-opencode` proves the adapter rebuilds the same timeline.

SSE and forwarding fixtures use a local Node `http` server, so the stream and forwarding tests need
no engine. The transport tests simulate both ends with `MessageChannel` from `node:worker_threads`,
and the host test injects a fake gateway, so neither needs Electron or a display.

### Validation Commands

```bash
bun run check
bun run test
bun run typecheck
bun run check:deps
```

## 21. Performance and Reliability

Only targets that come from a real source are listed. No latency target is invented.

| ID      | Requirement                            | Target                                            | Source / validation                                  |
|---------|----------------------------------------|---------------------------------------------------|------------------------------------------------------|
| OPS-001 | Idle stream detection                  | Abort after 45 s with no bytes; heartbeats reset   | Upstream `defaultIdleTimeout`; `events.test.ts` (BR-013, CASE-001/002) |
| OPS-002 | Reconnect backoff                      | 1, 2, 5, 10 s, capped; reset on a good connect     | `events.test.ts` (BR-014, CASE-014)                 |
| OPS-003 | Event batching window                  | Default 16 ms, configurable                        | `events.test.ts` (BR-016); confirmed per Q-004      |
| OPS-004 | Channel request timeout                | 30 s default                                       | T-002                                                 |
| OPS-005 | Connect timeout for the stream         | 2 s                                                | Upstream `connectTimeout`; `events.test.ts` (OPS-005) |
| OPS-006 | Upstream streams per connected server  | 1, independent of window count                     | `events.test.ts` (BR-011); `gateway-host.test.ts` (T-009 AC-2) |

Event volume and payload limits are Unknown; the batching window bounds renderer wakeups, and the
engine bounds the stream at 4,096 queued events per subscriber. Timeouts and retries for forwarded
requests follow §16; non-idempotent calls are never retried.

## 22. Configuration and Feature Flags

There is no feature-flag rollout; the gateway is always on. These are internal constants with the
values fixed by this document so implementing tasks do not choose them.

| Setting                     | Status  | Default                     | Purpose                                      | Restart? |
|-----------------------------|---------|-----------------------------|----------------------------------------------|----------|
| `SUPPORTED_RANGE`           | Current | `>=2.0.20 <2.1.0`           | Declared engine support range                | No       |
| `HIGHEST_TESTED_VERSION`    | Current | `2.0.26`                    | Boundary between `supported` and `untested`  | No       |
| `STREAM_IDLE_TIMEOUT_MS`    | Current | `45000`                     | Watchdog for a silent stream                 | No       |
| `STREAM_CONNECT_TIMEOUT_MS` | Current | `2000`                      | Give up on a stream that never starts        | No       |
| `EVENT_BATCH_INTERVAL_MS`   | Current | `16`                        | Fan-out batching window                      | No       |
| `RECONNECT_BACKOFF_MS`      | Current | `[1000, 2000, 5000, 10000]` | Reconnect backoff, capped                    | No       |
| `CHANNEL_TIMEOUT_MS`        | Current | `30000`                     | Default channel request timeout (T-002)      | No       |
| `FORWARD_TIMEOUT_MS`        | Current | `30000`                     | Give up on a forwarded request and map to `timeout` (T-006) | No |
| `START_ALLOWED`             | Current | `true`                      | Whether start policy may spawn the user CLI  | No       |

## 23. Dependencies and Impact Analysis

| Dependency or consumer       | Relationship | Change impact                                                    | Compatibility action                                 |
|------------------------------|--------------|------------------------------------------------------------------|------------------------------------------------------|
| `@opencode/client/service`   | Upstream     | Discovery, ensure, stop and probe behaviour                       | Wrapped behind an injectable interface; version matrix (T-014) |
| `@opencode/client` (types)   | Upstream     | Server info types                                                 | Types only; never re-exported to features             |
| `@mortise/domain`            | Upstream     | `ServerRef`, `ConnectionState`, `EngineInfo`, `EngineCapabilities` | Provided by T-001; the gateway consumes it            |
| `@mortise/rpc-contracts`     | Upstream     | Channel methods and events                                        | Provided by T-002; the gateway registers handlers     |
| `@mortise/engine-opencode`   | Peer         | Uses the gateway's `engine.fetch`; never imported by the gateway  | No direct import; the channel is the boundary         |
| `@mortise/workbench`         | Downstream   | Consumes connection state and events                              | Debug string view from T-009 (`packages/workbench/src/app.tsx`); full UI in T-012 |
| OpenCode engine versions     | External     | A new minor may add capabilities or move the floor                | Declared range plus `untested` state; capability flags |

The gateway is the second of the two packages allowed to import OpenCode (ADR-0004). It must stay
host-neutral: no Electron, React or DOM imports (C11). This is why the Electron wiring is a separate
task and a separate file (`gateway-host.ts`).

## 24. Implementation Plan

Phases 1, 2, 3 and 4 are implemented at `1d4669d`, `4323cc7`, `508aaff` and `49d4309`.

### Phase 1: Discovery and the connection state machine (T-004) — Status: **Current**

**Objective:** Find the user's service, decide whether to start one, compute the support state, and expose the connection state machine. Covers P1.

**Actual changes:** `packages/gateway-core/src/discovery.ts`, `probe.ts`, `capabilities.ts`, `connection.ts`, `gateway.ts`, `logging.ts`, and JSDoc'd exports in `index.ts`. `logging.ts` was not in the original plan; the prohibited-field logger needed a home.

**Behavior introduced:** BR-001..BR-010 and BR-018; every §10 transition except `hydrating`, which the gateway never emits (Q-001).

**Validation:** Unit tests cover every transition with injected fakes; `ensure()` is never called with a version and never when a registration exists; no public value or log line contains the password. `bun run check` passes at `1d4669d`.

**Completion criteria:** AC-001..AC-004 pass; `bun run check:deps` holds. AC-007's host-independent part (one gateway per server) is deferred to T-005/T-009 because it needs the stream; T-005 delivered the events half (BR-011), and T-009 delivered the two-window host half.

**Recovery:** No persistent state; a bad build is a code rollback.

### Phase 2: Event stream, batching and resync (T-005) — Status: **Current**

**Objective:** One authenticated stream per server, with watchdog, backoff, generation, batching and resync. Covers P2 and P3.

**Actual changes:** `packages/gateway-core/src/events.ts` (new: `createEventStream`); `gateway.ts` creates the stream, starts it from `onServiceReady`, stops it on a terminal connection state and exposes it as `internal.events`; `index.ts` exports the new symbols.

**Behavior introduced:** BR-011..BR-017 and OPS-001, OPS-002, OPS-003, OPS-005, OPS-006. The 401 path calls `connection.onUnauthorized` (§16).

**Validation:** `events.test.ts` drives a local Node `http` SSE fixture with an injected clock: ordered batching, malformed skip, first-event rejection, heartbeat survival past 45 s, stall and server-close reconnect with resync, the buffered-batch-before-resync ordering pin, backoff 1/2/5/10 s capped, connect timeout, two subscribers on one upstream, the last subscriber closing it, and a clean stop with no pending timers. `gateway.test.ts` proves a stream 401 reaches `unauthorized`.

**Completion criteria:** AC-005..AC-007 pass; `bun run check` passes at `4323cc7`; no open handles after stop. AC-007's desktop-host half is delivered by T-009 at `49d4309`.

### Phase 3: Authenticated request forwarding (T-006) — Status: **Current**

**Objective:** Answer `engine.fetch` by forwarding with Basic auth and mapping errors. Covers P3.

**Actual changes:** `packages/gateway-core/src/forward.ts` (new: `createForwardHandler`,
`ForwardDeps`, `FORWARD_TIMEOUT_MS`); `index.ts` exports them. The handler is what T-009 registers on
the channel server; the gateway's `internal.endpoint()` and `internal.connection` are its inputs.

**Behavior introduced:** BR-019..BR-026 and SEC-003, SEC-004; a gateway-side `FORWARD_TIMEOUT_MS`
(§22). The handler re-validates the path and headers before any network call, injects Basic auth from
the adopted endpoint, classifies the body as text or base64, strips `set-cookie`, calls
`connection.onUnauthorized` on a `401`, and forwards at most once.

**Validation:** `forward.test.ts` drives a local Node `http` server: the `Authorization: Basic` header
for username `opencode`, a JSON/text round-trip with query parameters, base64 binary round-trip,
`set-cookie` stripping, `forbidden_path` for `..`, an encoded traversal, an absolute URL, `/auth/*`
and the three forbidden headers with zero upstream requests, `engine_unreachable` and `timeout`
mapping, a `401` that reaches `onUnauthorized`, a single forward for a non-idempotent POST, and a
capturing logger that never sees a password, auth header or body content.

**Completion criteria:** AC-008..AC-009 pass; `bun run check` passes at `508aaff`; a capturing logger
proves no secret is logged.

**Recovery:** No persistent state; a bad build is a code rollback.

### Phase 4: Desktop host and MessagePort channel (T-009) — Status: **Current**

**Objective:** Run one gateway in main and give each window a private channel that never holds a credential. Covers P3.

**Actual changes:** `apps/desktop/src/main/gateway-host.ts` (new: `createGatewayHost`), `apps/desktop/src/main/transport.ts` (new: `mainTransport`), `apps/desktop/src/renderer/transport.ts` (new: `rendererTransport`), the channel forwarding in `apps/desktop/src/preload/index.ts`, the port handshake in `apps/desktop/src/renderer/main.tsx`, and the temporary connection view in `packages/workbench/src/app.tsx`. `apps/desktop/src/main/index.ts` now creates the host at app ready, attaches every window, and disposes it on quit. `apps/desktop/tsconfig.node.json` adds the DOM lib because the sandboxed preload runs in a DOM context.

**Behavior introduced:** One gateway for the app; a `MessageChannelMain` per window whose main end backs a `createServer` channel with `servers.list`, `connection.get` and `engine.fetch`; per-window subscriptions to `connection.changed`, `engine.events` and `engine.resync`; teardown of a window's channel and subscriptions on close; gateway disposal on quit and never an engine stop. The preload forwards the transferred port with `window.postMessage("mortise:channel", "*", event.ports)` and exposes nothing new; the renderer accepts a port only from `event.source === window` with `event.data === "mortise:channel"`.

**Validation:** `gateway-host.test.ts` uses a fake gateway and worker-thread `MessageChannel`s to prove one create/start for two windows, one stream and one connection subscription per channel server, request routing to the shared gateway, per-window teardown, fan-out, and reload replacement. `transport.test.ts` in both `main` and `renderer` runs the channel client and server over `node:worker_threads` ports. `bun run check` and `bun run build` pass at `49d4309`. The manual `bun run dev` check started the app without a sandbox failure, but the installed engine is `2.1.2`, above the supported `<2.1.0`, so the gateway reported `incompatible`; see the task Result. The production renderer bundle is not free of the words `password` and `authorization` because React DOM and the shared channel schemas contain them; the credential-specific check from Q-007 is clean, so AC-011 passes.

**Completion criteria:** AC-010 and AC-011 pass; window security flags are unchanged (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`).

## 25. Deployment, Migration, and Rollback

Not applicable in the usual sense: this is in-app code with no storage migration and no server
deployment. Rollback is a code revert. The one caution is operational, not a migration: the gateway
never changes the shared service, so a bad build cannot strand the user's engine.

## 26. Risks and Limitations

| Risk ID  | Risk                                                        | Likelihood | Impact   | Mitigation                                                        |
|----------|-------------------------------------------------------------|------------|----------|-------------------------------------------------------------------|
| RISK-001 | The official desktop or TUI replaces the shared service mid-session | High  | Medium   | Detect replacement, return to `discovering`, rejoin (§BR-010)     |
| RISK-002 | A version war over the shared service                       | Medium     | Medium   | Join-never-replace policy; restart only with consent (§BR-003)    |
| RISK-003 | Event loss produces wrong state                             | Medium     | High     | Resync on every reconnect; generation tag; resilience tests (T-013) |
| RISK-004 | A credential leaks into a log or the renderer               | Low        | Critical | SEC-001..SEC-005; capturing-logger tests                          |
| RISK-005 | A forbidden path or header reaches the engine               | Low        | High     | Allowlist and header rules re-validated gateway-side (§BR-019, BR-020) |
| RISK-006 | A newer engine changes discovery or the probe shape         | Medium     | Medium   | Wrapped behind an injectable interface; nightly matrix (T-014)    |

### Current Limitations

| Limitation                                             | Impact                                             | Planned resolution                          |
|--------------------------------------------------------|----------------------------------------------------|---------------------------------------------|
| One shared server only, in Phase 0                     | Remote servers unavailable                          | Remote and pairing in a later phase         |
| Isolated-engine mode not implemented                   | No private history option yet                       | Later; requires its own `OPENCODE_DB`        |
| Secrets held in main memory, not the keychain          | Secret survives in the process only                 | Keychain integration later                  |
| `hydrating` → `live` trigger crosses the gateway/window boundary | The gateway cannot observe snapshot completion | Q-001                                       |

## 27. Decisions

| Decision ID | Status   | Decision                                                              | Rationale                                                              | Alternatives                                   | Date       |
|-------------|----------|-----------------------------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------|------------|
| DEC-001     | Proposed | Join the shared service; never replace it unasked                     | Two engines on one database are likely unsafe; sessions should be shared | Always spawn a private engine; pin and replace | 2026-10-10 |
| DEC-002     | Proposed | The gateway lives in main; the logic stays host-neutral in `gateway-core` | Credentials and one stream per server require one owner; web reuses the core | Renderer connects directly; separate server process | 2026-10-10 |
| DEC-003     | Proposed | Declare a supported range and detect capabilities rather than pinning | Daily engine releases; strict bodies reject unknown fields              | Pin one exact version                          | 2026-10-10 |
| DEC-004     | Proposed | Resync over replay; the stream is treated as lossy                    | Upstream sends no replay and fails on queue overflow                    | Cache-and-replay deltas                        | 2026-10-10 |
| DEC-005     | Proposed | Inject Basic auth in the gateway; renderers use an IPC-backed `fetch` | The password must never reach a renderer (C7)                           | Password in the renderer; per-window tokens    | 2026-10-10 |
| DEC-006     | Proposed | A path allowlist plus header rejection is the forwarding boundary    | Defense in depth against a renderer that supplies hostile input         | Trust the channel schema alone                 | 2026-10-10 |
| DEC-007     | Proposed | A `HIGHEST_TESTED_VERSION` constant drives the `untested` state       | Newer patches must be usable, but flagged honestly                     | Block anything newer than the floor            | 2026-10-10 |

DEC-001 to DEC-003 restate existing accepted ADRs (ADR-0002, ADR-0003, ADR-0012) for the gateway's
own readers. They do not change any ADR. A decision that would change one must stop and ask first.

## 28. Open Questions

| ID    | Question                                                                                   | Owner              | Needed by | Status |
|-------|--------------------------------------------------------------------------------------------|--------------------|-----------|--------|
| Q-001 | Is `hydrating` → `live` a gateway state or a per-window state? The gateway does not read snapshots. | Mortise maintainers | T-004 | Resolved |
| Q-002 | What monitoring signals are wanted (counters, alerts), if any, in Phase 0?                  | Mortise maintainers | T-009     | Resolved |
| Q-003 | Is offering a consented restart in Phase 0 scope, or deferred to a later phase?             | Mortise maintainers | T-004     | Resolved |
| Q-004 | Confirm the batching default: 16 ms (T-005) versus upstream 10 ms and OpenChamber 50 ms.    | Mortise maintainers | T-005     | Resolved |
| Q-005 | When no compatible service runs but the installed CLI is below the floor, which read-only features remain? | Mortise maintainers | T-004 | Resolved |
| Q-006 | Should the gateway surface `no-engine` rechecks only on window focus, or also on a timer?   | Mortise maintainers | T-004     | Resolved |
| Q-007 | The T-009 bundle check `rg "password\|authorization" apps/desktop/out/renderer` matches React DOM's password input branch and `@mortise/rpc-contracts`' header-validation messages, not credential handling. Should SEC-005 and AC-011 use a narrower check (for example, a credential-specific pattern), or should the shared schema text change? | Mortise maintainers | T-009 | Resolved |

### Answers (maintainer, 2026-10-10)

These answers are binding for T-004, T-005 and T-009. Where they change a rule above, the answer wins.

- **Q-001:** `hydrating` is a per-window state, not a gateway state. The gateway goes `connecting → live` once `/api/info` succeeds and the event stream delivers `server.connected`, and `resyncing → live` after a reconnect (preceded by `engine.resync`). It never emits `hydrating`. The workbench composition root (T-012) shows `hydrating` for its own window from the moment it sees `live` or `engine.resync` until its snapshots load. `ConnectionState` keeps the `hydrating` phase for that UI use.
- **Q-002:** Phase 0 has no alerts and no metrics pipeline. The gateway writes structured logs (never secrets or payloads) and keeps in-memory counters (reconnects, current generation, last error) that tests can read. A diagnostics view comes in Phase 1.
- **Q-003:** Deferred. In Phase 0 the `incompatible` state shows the installed and required versions and how to update OpenCode. No restart offer.
- **Q-004:** 16 ms, one display frame, configurable. It sits between upstream's 10 ms and OpenChamber's 50 ms and matches the renderer's frame batching.
- **Q-005:** No engine features. The app shell, settings and themes keep working; every engine-backed view shows the update instructions with the installed and minimum versions.
- **Q-006:** Both. Recheck when a window gains focus, on an explicit "Retry", and on a 30-second timer while in `no-engine`. Discovery is cheap (a file read and one local HTTP probe), but do not poll faster than that.

### Answers (maintainer, 2026-10-22)

- **Q-007:** Replace the broad `password|authorization` search with credential-specific evidence. After `bun run build`, the preload must contain no `password`, `authorization` or `Basic `, and the renderer must contain no `Basic `, `info.password`, `opencode:` or `endpoint.auth`. React DOM's input-type strings and the shared forbidden-header list may remain. AC-011 and SEC-005 use this check; the shared schema text does not change.

## 29. AI Agent Instructions

### Safe Modification Areas

- `packages/gateway-core/src/*.ts` (except the credential and forwarding paths below).
- Tests next to the code, `*.test.ts`.

### Restricted Areas

- Credential handling and Basic auth injection (`forward.ts`, `connection.ts`) — needs security review.
- The path allowlist and header rules — the forwarding security boundary.
- `apps/desktop/src/preload/` — sandboxed, security-sensitive.
- `@opencode/*` imports — only the two allowed packages (ADR-0004).
- `.dependency-cruiser.cjs` — do not weaken; changes need maintainer review.

### Required Before Coding

1. Read this document and the cited rules; cite the rule IDs in test names.
2. Read `../opencode/engine-contract.md` ("Agent gotchas", sections 2, 3, 4, 13.2, 13.3, 13.6) before any engine call.
3. Resolve or explicitly preserve the Open Questions above.
4. Confirm the planned paths still match the task you are implementing.

### Required Before Completion

1. Add a test named for every rule ID you implement.
2. Run `bun run check`.
3. Update §11, §14, §15 and §30; replace planned paths with actual ones.
4. Update `last_updated`, and set `last_verified_commit` only when the code was actually read.

## 30. Changelog

| Date       | Version | Change                        | Status  | Author             |
|------------|---------|-------------------------------|---------|--------------------|
| 2026-10-10 | 0.1.0   | Initial pre-implementation design | Planned | deepseek-v4.1-flash |
| 2026-10-10 | 0.1.1   | Mode D sync for T-004: discovery, probe, capabilities, connection machine and gateway are `Current` at `1d4669d`; corrected the stale §11 domain and contracts rows | Current | deepseek-v4.1-flash |
| 2026-10-10 | 0.1.2   | Cover the probe-failure path: `connection.test.ts` now asserts an unreachable probe and a non-2xx probe both reach `failed`, and that retry recovers (§16) | Current | deepseek-v4.1-flash |
| 2026-10-11 | 0.1.3   | Mode D sync for T-005: the event stream (`events.ts`) is `Current` at `4323cc7`; BR-011..BR-017, AC-005..AC-007 and OPS-001/002/003/005/006 move to `Current`; corrected stale §12 event and §22 configuration statuses | Current | deepseek-v4.1-flash |
| 2026-10-11 | 0.1.4   | Mode D sync for T-006: `forward.ts` is `Current` at `508aaff`; BR-019..BR-026, AC-008, AC-009, SEC-003 and SEC-004 move to `Current`; added the `FORWARD_TIMEOUT_MS` constant to §22 | Current | deepseek-v4.1-flash |
| 2026-10-11 | 0.1.5   | Relay a handler-thrown `ChannelError` code through `createServer` (`channel.ts` at `cf291d5`) so the forwarding boundary's `forbidden_path`, `engine_unreachable` and `timeout` reach the caller instead of collapsing to `internal` | Current | deepseek-v4.1-flash |
| 2026-10-11 | 0.1.6   | Mode D sync for T-013: added the coexistence (`gateway-core`) and resync (`engine-opencode`) integration suites and the sandbox `--service`, `stateDir`, `reuse` and `dispose` support they need; recorded the real paths in §20 and marked CASE-006 covered | Current | deepseek-v4.1-flash |
| 2026-10-22 | 0.2.0   | Mode D sync for T-009: the gateway host (`gateway-host.ts`), the main and renderer `transport.ts` files, the preload port forwarding and the debug view are `Current` at `49d4309`; `servers.list` and `connection.get` become `Current`; AC-010 and the two-window half of AC-007 pass. AC-011 and SEC-005 are `Unknown` because the prescribed bundle search matches React DOM and shared-schema text (Q-007) | Current | deepseek-v4.1-flash |
| 2026-10-22 | 0.2.1   | Resolve Q-007: AC-011 and SEC-005 use a credential-specific bundle check instead of `password\|authorization`, which React DOM and the shared schema list also match. Both become `Current` at `49d4309` | Current | deepseek-v4.1-flash |

## 31. Related Resources

- Engine contract reference: [`docs/opencode/engine-contract.md`](../opencode/engine-contract.md)
- Architecture overview: [`docs/architecture/overview.md`](../architecture/overview.md)
- Roadmap and Phase 0 criteria: [`docs/architecture/roadmap.md`](../architecture/roadmap.md)
- Decisions: ADR-0002 [`join the shared service`](../adr/0002-join-the-shared-service-never-replace-it-unasked.md), ADR-0003 [`gateway in main`](../adr/0003-engine-gateway-in-the-electron-main-process.md), ADR-0004 [`adapter as the only OpenCode-aware code`](../adr/0004-adapter-package-as-the-only-opencode-aware-code.md), ADR-0012 [`declared engine range`](../adr/0012-declared-engine-range-with-capability-detection.md)
- Implementing tasks: [`tasks/T-004`](../../tasks/T-004-gateway-discovery.md), [`tasks/T-005`](../../tasks/T-005-gateway-events.md), [`tasks/T-006`](../../tasks/T-006-gateway-forwarding.md), [`tasks/T-009`](../../tasks/T-009-desktop-gateway-host.md)
- Upstream at v2.0.25: [`promise/service.ts`](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/client/src/promise/service.ts), [`service-probe.ts`](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/client/src/service-probe.ts), [`solid/connection.ts`](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/client/src/solid/connection.ts), [`event-feed.ts`](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/server/src/event-feed.ts), [`handlers/event.ts`](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/server/src/handlers/event.ts), [`background-service.ts`](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/desktop/src/main/service/background-service.ts)
