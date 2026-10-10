# @mortise/engine-opencode

Adapter that maps OpenCode wire formats to the Mortise domain model.

- **Status:** Phase 0, task T-008
- **Entry point:** `src/index.ts`

## Responsibility
The only package allowed to import `@opencode/*`. It builds a typed OpenCode client over an injected `fetch` (the gateway transport), maps requests and responses to domain types, translates wire events into domain events, and derives capability flags from the connected engine. It holds no credentials and renders nothing.

## Allowed imports
- `@opencode/client` (Promise root only)
- `@mortise/domain`

## Forbidden imports
- `@opencode/client/effect`
- `@opencode/client/solid`
- `@opencode/client/service`
- `react`
- `electron`
- Any `@mortise/*` package other than `@mortise/domain`

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.

## Endpoints to domain types

| Operation | Endpoint | Domain result |
| --- | --- | --- |
| `listSessions` | `GET /api/session` | `SessionSummary[]` |
| `getSession` | `GET /api/session/{id}` | `SessionSummary` |
| `createSession` | `POST /api/session` | `SessionSummary` |
| `prompt` | `POST /api/session/{id}/prompt` | — (sends `id: clientMessageId`) |
| `interrupt` | `POST /api/session/{id}/interrupt` | `boolean` |
| `timeline` | `GET /api/session/{id}/message` | `TimelineItem[]` |
| `pendingRequests` | `GET /api/permission/request`, `GET /api/form` | `PendingRequest[]` |
| `answerPermission` | `POST /api/session/{id}/permission/{rid}/reply` | — |
| `answerForm` | `POST /api/session/{id}/form/{fid}/reply` | — |
| `cancelForm` | `DELETE /api/session/{id}/form/{fid}` | — |

## Wire events to domain events

| Wire event | Domain event |
| --- | --- |
| `session.created` | `session.changed` |
| `session.execution.started` | `session.activity` `running` |
| `session.execution.succeeded` / `.failed` / `.interrupted` | `session.activity` `idle` |
| `session.retry.scheduled` | `session.activity` `retrying` |
| `session.inbox.enqueued` (user) | `timeline.patch` `item.added` |
| `session.inbox.delivered` | `timeline.patch` `item.patched` (`createdAt`) |
| `session.step.started` | `timeline.patch` `item.added` (assistant) |
| `session.step.failed` | `timeline.patch` `part.added` (error) |
| `session.text.*` / `session.reasoning.*` | `timeline.patch` `part.added` / `part.text.appended` / `part.updated` |
| `session.tool.input.started` | `timeline.patch` `part.added` (tool, keyed by call id) |
| `session.tool.input.ended` / `.called` / `.progress` / `.success` / `.failed` | `timeline.patch` `part.patched` |
| `permission.asked` | `request.opened` |
| `permission.replied` | `request.closed` |
| `form.created` | `request.opened` |
| `form.replied` / `form.cancelled` | `request.closed` |

Everything else the engine emits (catalog refreshes, usage, PTYs, TUI, shell, compaction, revert, plugin RPC) yields no domain event. An event with a type the adapter does not know increments `eventDiagnostics().unknownTypes`; a known type with a payload that does not match its shape increments `malformedPayloads`. `translate` never throws.

## Notes

- The recorded responses under `fixtures/<version>/` are replayed through a fake `fetch` in the contract tests. `fixtures/` is recorded engine output; do not reformat it.
- Reads trust the generated client's decoded types. Events are raw JSON, so `translate` validates each payload itself.
