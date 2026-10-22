import type { MessageId, SessionId } from "@mortise/domain"
import { useCallback, useSyncExternalStore } from "react"
import type { TimelineReader } from "./contract"
import { PartView } from "./parts"

/**
 * One timeline item. It subscribes to the item's part membership, not to part values, so streaming
 * text never re-renders the item or its sibling parts.
 */
export function TimelineItemView({
  timeline,
  sessionId,
  messageId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
  readonly messageId: MessageId
}) {
  const refs = useSyncExternalStore(
    useCallback(
      (listener) => timeline.subscribePartRefs(sessionId, messageId, listener),
      [timeline, sessionId, messageId],
    ),
    useCallback(() => timeline.partRefs(sessionId, messageId), [timeline, sessionId, messageId]),
  )
  const item = timeline.item(sessionId, messageId)
  if (item === undefined) return null

  return (
    <li className={`timeline-item timeline-item-${item.kind}`} data-message-id={item.id}>
      {refs.map((ref) => (
        <PartView key={ref.id} timeline={timeline} sessionId={sessionId} partId={ref.id} kind={ref.kind} />
      ))}
    </li>
  )
}
