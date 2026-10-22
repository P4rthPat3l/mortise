import type { Channel } from "@mortise/rpc-contracts"
import { ModuleHostProvider } from "@mortise/sdk"
import { useEffect, useState } from "react"
import { createWorkbenchRuntime, type WorkbenchRuntime } from "./bootstrap/runtime"
import { WorkbenchShell } from "./shell"
import "@mortise/ui/tokens.css"
import "./app.css"

/** The workbench entry: boot the composition root once per gateway channel. */
export function App({ channel }: { readonly channel: Channel }) {
  const [runtime, setRuntime] = useState<WorkbenchRuntime>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let created: WorkbenchRuntime | undefined
    void createWorkbenchRuntime({ channel })
      .then((next) => {
        if (cancelled) {
          next.dispose()
          return
        }
        created = next
        setRuntime(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The gateway did not answer")
      })

    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [channel])

  if (error !== undefined) {
    return (
      <main className="app-message">
        <h1>Mortise</h1>
        <p className="error" role="alert">
          {error}
        </p>
      </main>
    )
  }

  if (runtime === undefined) {
    return (
      <main className="app-message">
        <h1>Mortise</h1>
        <p className="muted">Connecting to the engine…</p>
      </main>
    )
  }

  return (
    <ModuleHostProvider host={runtime.host}>
      <WorkbenchShell runtime={runtime} />
    </ModuleHostProvider>
  )
}
