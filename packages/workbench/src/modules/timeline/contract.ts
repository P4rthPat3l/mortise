import type { MessageId, PartId, SessionId, TimelineItem, TimelinePart, TimelinePatch } from "@mortise/domain"
import { Contract } from "@mortise/sdk"
import type { Readable } from "../sessions/contract"

/** Identity and render kind of one part. */
export interface TimelinePartRef {
  readonly id: PartId
  readonly kind: TimelinePart["kind"]
}

/**
 * The read surface of the timeline store. The composition root passes the core store, which
 * satisfies this shape; modules never import `@mortise/core`.
 */
export interface TimelineReader {
  sessionIds(): readonly SessionId[]
  subscribeSessionIds(listener: () => void): () => void
  itemIds(sessionId: SessionId): readonly MessageId[]
  subscribeItemIds(sessionId: SessionId, listener: () => void): () => void
  item(sessionId: SessionId, messageId: MessageId): TimelineItem | undefined
  items(sessionId: SessionId): readonly TimelineItem[]
  partRefs(sessionId: SessionId, messageId: MessageId): readonly TimelinePartRef[]
  subscribePartRefs(sessionId: SessionId, messageId: MessageId, listener: () => void): () => void
  part(sessionId: SessionId, partId: PartId): TimelinePart | undefined
  subscribePart(sessionId: SessionId, partId: PartId, listener: () => void): () => void
  apply(sessionId: SessionId, patch: TimelinePatch): void
}

/** One session's latest read. */
export interface TimelineLoadState {
  readonly status: "idle" | "loading" | "ready" | "error"
  readonly error?: string
}

/** The timeline service the composition root provides. */
export interface TimelineServiceValue {
  readonly store: TimelineReader
  readonly status: Readable<Readonly<Record<string, TimelineLoadState>>>
  load(sessionId: SessionId): void
}

/** The contract the timeline module provides. */
export const Timeline = Contract.define<TimelineServiceValue>("timeline")

/** The contract the composition root provides to the timeline module. */
export const TimelineService = Contract.define<TimelineServiceValue>("timeline.service")
