import type { ConnectionState } from "./connection.js"
import type { RequestId, SessionId } from "./ids.js"
import type { PendingRequest } from "./requests.js"
import type { SessionActivity, SessionSummary } from "./session.js"
import type { TimelinePatch } from "./timeline.js"

/**
 * Why views must be rebuilt from fresh reads. The event stream is lossy, so any of these means
 * "do not trust what you have".
 */
export type ResyncReason = "reconnected" | "overflow" | "gap"

/**
 * A change the UI should apply, already translated from engine events by the adapter.
 * Discriminated by `type`.
 */
export type DomainEvent =
  | { readonly type: "session.changed"; readonly session: SessionSummary }
  | {
      readonly type: "session.activity"
      readonly sessionId: SessionId
      readonly status: SessionActivity
    }
  | { readonly type: "timeline.patch"; readonly sessionId: SessionId; readonly patch: TimelinePatch }
  | { readonly type: "request.opened"; readonly request: PendingRequest }
  | { readonly type: "request.closed"; readonly requestId: RequestId }
  | { readonly type: "resync"; readonly reason: ResyncReason }
  | { readonly type: "connection.changed"; readonly state: ConnectionState }
