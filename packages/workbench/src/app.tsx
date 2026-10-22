import type { ConnectionState } from "@mortise/domain"
import type { Channel } from "@mortise/rpc-contracts"
import { useEffect, useState } from "react"

// Temporary debug shell for T-009. T-011 replaces it with the composition root that wires the
// adapter, core and modules; until then it proves the window holds a working gateway channel.
export function App({ channel }: { readonly channel: Channel }) {
  const [state, setState] = useState<ConnectionState>({ phase: "discovering" })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = channel.subscribe("connection.changed", ({ state: next }) => {
      if (!cancelled) setState(next)
    })

    void (async () => {
      try {
        const servers = await channel.request("servers.list", undefined)
        const server = servers[0]
        if (server === undefined || cancelled) return
        const current = await channel.request("connection.get", { serverId: server.id })
        if (!cancelled) setState(current)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "the gateway did not answer")
      }
    })()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [channel])

  const version = "info" in state ? state.info.version : undefined

  return (
    <main>
      <h1>Mortise</h1>
      <p>
        Connection: {state.phase}
        {version === undefined ? "" : ` (OpenCode ${version})`}
      </p>
      {error === null ? null : <p>Gateway error: {error}</p>}
    </main>
  )
}
