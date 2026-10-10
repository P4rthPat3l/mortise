# @mortise/domain

Client-owned domain model shared by every layer.

- **Status:** Phase 0, task T-001
- **Entry point:** `src/index.ts`

## Responsibility
Types and small pure helpers for servers, engine info and capabilities, sessions, timeline items, pending requests, connection states and domain events. It describes the client's view of the world and must stay independent of OpenCode wire formats so engine upgrades never ripple through the app.

## Exports
| Export | Kind | File | Represents |
| --- | --- | --- | --- |
| `ServerId`, `SessionId`, `MessageId`, `PartId`, `RequestId`, `ProjectId` | branded types | `ids.ts` | Identifiers; constructors `serverId`, `sessionId`, `messageId`, `partId`, `requestId`, `projectId` brand without validating |
| `ServerRef` | type | `server.ts` | A server the user can connect to, with no credentials |
| `EngineCapabilities`, `SupportState`, `EngineInfo` | types | `engine.ts` | Connected engine version, features and support level |
| `ConnectionState`, `ConnectionPhase` | types | `connection.ts` | The ten engine connection phases, discriminated by `phase` |
| `SessionSummary`, `SessionActivity` | types | `session.ts` | A session list row and its activity |
| `TimelineItem`, `UserMessageItem`, `AssistantMessageItem` | types | `timeline.ts` | A message in the conversation |
| `TimelinePart`, `TextPart`, `ReasoningPart`, `ToolCallPart`, `ShellPart`, `CompactionPart`, `ErrorPart`, `ToolState` | types | `timeline.ts` | Renderable pieces of a message |
| `TimelinePatch` | type | `timeline.ts` | Incremental timeline updates |
| `isTerminalToolState` | function | `timeline.ts` | True for `success` and `failed` |
| `PendingRequest`, `PermissionRequest`, `FormRequest`, `FormQuestion`, `FormOption` | types | `requests.ts` | Things waiting on the user |
| `DomainEvent`, `ResyncReason` | types | `events.ts` | Translated engine changes plus `connection.changed` |

## Allowed imports
- Nothing. This package has no imports.

## Forbidden imports
- `@opencode/*`
- `react`
- `electron`
- `zod`
- Any other `@mortise/*` package
- Node or DOM APIs

These rules are enforced by `.dependency-cruiser.cjs` at the repository root. Read the repository `AGENTS.md` before changing this package.
