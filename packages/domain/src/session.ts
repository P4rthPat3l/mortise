import type { ProjectId, SessionId } from "./ids.js"

/** What a session is doing right now, for the session list and status indicators. */
export type SessionActivity = "idle" | "running" | "retrying"

/** One row in the session list. Corresponds to OpenCode's `Session.Info`, reduced to what the list shows. */
export interface SessionSummary {
  readonly id: SessionId
  readonly title: string
  readonly projectId: ProjectId
  readonly directory: string
  /** Epoch milliseconds. */
  readonly createdAt: number
  /** Epoch milliseconds. */
  readonly updatedAt: number
  readonly activity: SessionActivity
  /** Set when this session was spawned by another one (a subagent). */
  readonly parentId?: SessionId
}
