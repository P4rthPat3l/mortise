import type { SessionId, SessionSummary } from "@mortise/domain"
import { Contract } from "@mortise/sdk"

/** What the session list is doing. `error` is never rendered as an empty list. */
export type SessionListStatus = "loading" | "ready" | "error"

/** The session list and the current selection. */
export interface SessionListState {
  readonly status: SessionListStatus
  readonly sessions: readonly SessionSummary[]
  readonly selectedId?: SessionId
  readonly error?: string
}

/** The read surface every feature module uses instead of importing `@mortise/core`. */
export interface Readable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** The session list service the composition root provides. */
export interface SessionsValue {
  readonly store: Readable<SessionListState>
  refresh(): void
  select(id: SessionId): void
}

/** The contract the sessions module provides. */
export const Sessions = Contract.define<SessionsValue>("sessions")

/** The contract the composition root provides to the sessions module. */
export const SessionsService = Contract.define<SessionsValue>("sessions.service")
