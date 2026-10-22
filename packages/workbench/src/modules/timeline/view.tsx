import type { SessionId } from "@mortise/domain"
import { useModule } from "@mortise/sdk"
import { useCallback, useSyncExternalStore } from "react"
import type { SessionsValue } from "../sessions/contract"
import type { TimelineReader, TimelineServiceValue } from "./contract"
import { TimelineItemView } from "./item"
import { definition } from "./module"

/** Item order for one session: new items re-render here, part values do not. */
export function TimelineItems({
  timeline,
  sessionId,
}: {
  readonly timeline: TimelineReader
  readonly sessionId: SessionId
}) {
  const itemIds = useSyncExternalStore(
    useCallback((listener) => timeline.subscribeItemIds(sessionId, listener), [timeline, sessionId]),
    useCallback(() => timeline.itemIds(sessionId), [timeline, sessionId]),
  )

  return (
    <ol className="timeline" aria-label="Timeline">
      {itemIds.map((messageId) => (
        <TimelineItemView key={messageId} timeline={timeline} sessionId={sessionId} messageId={messageId} />
      ))}
    </ol>
  )
}

/** The module's view. It reads selection from the sessions contract, never from another module. */
export function TimelineView() {
  const ctx = useModule(definition)
  const sessions: SessionsValue = ctx.requires.sessions
  const service: TimelineServiceValue = ctx.requires.service
  const state = useSyncExternalStore(
    useCallback((listener) => sessions.store.subscribe(listener), [sessions.store]),
    useCallback(() => sessions.store.getSnapshot(), [sessions.store]),
  )
  const status = useSyncExternalStore(
    useCallback((listener) => service.status.subscribe(listener), [service.status]),
    useCallback(() => service.status.getSnapshot(), [service.status]),
  )

  const selected = state.selectedId
  if (selected === undefined) {
    return (
      <section className="timeline-panel" aria-label="Timeline">
        <p className="muted">Select a session to see its timeline.</p>
      </section>
    )
  }

  const load = status[selected]
  return (
    <section className="timeline-panel" aria-label="Timeline">
      <header className="panel-header">
        <h2>{state.sessions.find((session) => session.id === selected)?.title ?? "Timeline"}</h2>
        <button type="button" onClick={() => service.load(selected)}>
          Reload
        </button>
      </header>
      {load?.error === undefined ? null : (
        <p className="error" role="alert">
          Could not load this timeline: {load.error}
        </p>
      )}
      {load?.status === "loading" ? <p className="muted">Loading messages…</p> : null}
      <TimelineItems timeline={service.store} sessionId={selected} />
    </section>
  )
}
