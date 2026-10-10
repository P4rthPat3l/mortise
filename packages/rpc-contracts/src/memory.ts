import type { Transport } from "./channel.js"

/**
 * A pair of linked in-memory transports for tests: what one sends the other receives. Delivery is
 * synchronous, so an emitted event is observable right after the call that produced it.
 */
export function createMemoryTransportPair(): { client: Transport; server: Transport } {
  type Handler = (message: unknown) => void

  const clientHandlers = new Set<Handler>()
  const serverHandlers = new Set<Handler>()
  let clientClosed = false
  let serverClosed = false

  const deliver = (handlers: Set<Handler>, message: unknown) => {
    for (const handler of [...handlers]) handler(message)
  }

  const client: Transport = {
    send(message) {
      if (!serverClosed) deliver(serverHandlers, message)
    },
    onMessage(handler) {
      clientHandlers.add(handler)
      return () => {
        clientHandlers.delete(handler)
      }
    },
    close() {
      clientClosed = true
      clientHandlers.clear()
    },
  }

  const server: Transport = {
    send(message) {
      if (!clientClosed) deliver(clientHandlers, message)
    },
    onMessage(handler) {
      serverHandlers.add(handler)
      return () => {
        serverHandlers.delete(handler)
      }
    },
    close() {
      serverClosed = true
      serverHandlers.clear()
    },
  }

  return { client, server }
}
