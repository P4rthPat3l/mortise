import type { PartId, SessionId, TimelinePart } from "@mortise/domain"
import { useCallback, useSyncExternalStore } from "react"
import type { TimelineReader } from "./contract"

/** Subscribes one component to one part. A delta to another part never runs this render. */
export function usePart(timeline: TimelineReader, sessionId: SessionId, partId: PartId): TimelinePart | undefined {
  return useSyncExternalStore(
    useCallback((listener) => timeline.subscribePart(sessionId, partId, listener), [timeline, sessionId, partId]),
    useCallback(() => timeline.part(sessionId, partId), [timeline, sessionId, partId]),
  )
}
