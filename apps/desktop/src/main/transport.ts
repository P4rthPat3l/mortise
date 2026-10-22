import type { Transport } from "@mortise/rpc-contracts"

// The main-process end of a window's MessagePort channel (T-009). MessagePortMain is an Electron
// class, so the transport accepts the structural subset it uses; that keeps this file testable with
// a `MessageChannel` from `node:worker_threads` and keeps `gateway-host.ts` free of Electron.

/** The subset of Electron's `MessagePortMain` a channel transport needs. */
export interface MainMessagePort {
  postMessage(message: unknown): void
  on(event: "message", listener: (event: { readonly data: unknown }) => void): void
  off(event: "message", listener: (event: { readonly data: unknown }) => void): void
  start(): void
  close(): void
}

/**
 * Wraps one end of a window's `MessageChannelMain` as a {@link Transport}. `start()` releases the
 * messages the port queued before the server attached its listener.
 */
export function mainTransport(port: MainMessagePort): Transport {
  let closed = false
  const handlers = new Set<(message: unknown) => void>()
  const receive = (event: { readonly data: unknown }): void => {
    if (closed) return
    for (const handler of [...handlers]) handler(event.data)
  }

  port.on("message", receive)
  port.start()

  return {
    send(message) {
      if (!closed) port.postMessage(message)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close() {
      if (closed) return
      closed = true
      handlers.clear()
      port.off("message", receive)
      port.close()
    },
  }
}
