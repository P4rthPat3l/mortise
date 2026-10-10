// @mortise/domain: Client-owned domain model shared by every layer. See README.md.

export type { ConnectionPhase, ConnectionState } from "./connection.js"
export type { EngineCapabilities, EngineInfo, SupportState } from "./engine.js"
export type { DomainEvent, ResyncReason } from "./events.js"
export type { MessageId, PartId, ProjectId, RequestId, ServerId, SessionId } from "./ids.js"
export { messageId, partId, projectId, requestId, serverId, sessionId } from "./ids.js"
export type {
  FormOption,
  FormQuestion,
  FormRequest,
  PendingRequest,
  PermissionRequest,
} from "./requests.js"
export type { ServerRef } from "./server.js"
export type { SessionActivity, SessionSummary } from "./session.js"
export type {
  AssistantMessageItem,
  CompactionPart,
  ErrorPart,
  ReasoningPart,
  ShellPart,
  TextPart,
  TimelineItem,
  TimelinePart,
  TimelinePatch,
  ToolCallPart,
  ToolPartPatch,
  ToolState,
  UserMessageItem,
} from "./timeline.js"
export { isTerminalToolState } from "./timeline.js"
