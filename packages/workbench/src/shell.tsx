import type { ConnectionState } from "@mortise/domain"
import { useCallback, useSyncExternalStore } from "react"
import type { WorkbenchRuntime } from "./bootstrap/runtime"

const describe = (state: ConnectionState): string => {
  switch (state.phase) {
    case "hydrating":
    case "live":
    case "resyncing":
      return `${state.phase} · OpenCode ${state.info.version}`
    case "incompatible":
      return `incompatible · ${state.engineVersion ?? "unknown version"} (needs ${state.supportedRange})`
    default:
      return state.phase
  }
}

/**
 * The app shell. It knows the three regions, not the modules that fill them: the composition root
 * supplies the views for this Phase 0 skeleton.
 */
export function WorkbenchShell({ runtime }: { readonly runtime: WorkbenchRuntime }) {
  const connection = useSyncExternalStore(
    useCallback((listener) => runtime.connection.subscribe(listener), [runtime.connection]),
    useCallback(() => runtime.connection.getSnapshot(), [runtime.connection]),
  )
  const Sessions = runtime.views.sessions
  const Timeline = runtime.views.timeline
  const Composer = runtime.views.composer

  return (
    <div className="workbench">
      <header className="titlebar">
        <h1>Mortise</h1>
        <p className="muted">{describe(connection)}</p>
      </header>
      <div className="workbench-layout">
        <aside className="side-region">
          <Sessions />
        </aside>
        <main className="main-region">
          <Timeline />
        </main>
      </div>
      <div className="composer-region">
        <Composer />
      </div>
    </div>
  )
}
