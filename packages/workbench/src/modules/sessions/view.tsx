import { useModule } from "@mortise/sdk"
import { useCallback, useSyncExternalStore } from "react"
import type { SessionsValue } from "./contract"
import { definition } from "./module"

/** The session list. A failed read stays visible as an error instead of becoming an empty list. */
export function SessionsPanel({ sessions }: { readonly sessions: SessionsValue }) {
  const state = useSyncExternalStore(
    useCallback((listener) => sessions.store.subscribe(listener), [sessions.store]),
    useCallback(() => sessions.store.getSnapshot(), [sessions.store]),
  )

  return (
    <section className="sessions-panel" aria-label="Sessions">
      <header className="panel-header">
        <h2>Sessions</h2>
        <button type="button" onClick={() => sessions.refresh()}>
          Refresh
        </button>
      </header>

      {state.error === undefined ? null : (
        <p className="error" role="alert">
          Could not load sessions: {state.error}
        </p>
      )}

      {state.status === "loading" && state.sessions.length === 0 ? <p className="muted">Loading sessions…</p> : null}

      {state.status === "ready" && state.sessions.length === 0 ? (
        <p className="muted">No sessions yet. Send a prompt to start one.</p>
      ) : null}

      <ul className="session-list">
        {state.sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              className="session-row"
              aria-pressed={session.id === state.selectedId}
              onClick={() => sessions.select(session.id)}
            >
              <span className="session-title">{session.title === "" ? "Untitled session" : session.title}</span>
              <span className={`activity activity-${session.activity}`}>{session.activity}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The module's view: resolves its service from the module context. */
export function SessionsView() {
  const ctx = useModule(definition)
  return <SessionsPanel sessions={ctx.requires.service} />
}
